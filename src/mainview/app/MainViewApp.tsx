import "react-resizable/css/styles.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { unstable_serialize, useSWRConfig } from "swr";
import { useSnapshot } from "valtio";
import type {
	AppUpdateState,
	MattermostSsoProvider,
} from "../../shared/electrobunRpc";
import { AttachmentPreviewDialog } from "../components/AttachmentPreviewDialog";
import { AuthScreen } from "../components/AuthScreen";
import type { MessageComposerHandle } from "../components/MessageComposer";
import { CallProvider } from "../contexts/CallContext";
import {
	MAX_COMPOSER_HEIGHT,
	MAX_SIDEBAR_WIDTH,
	MIN_COMPOSER_HEIGHT,
	MIN_SIDEBAR_WIDTH,
	useChannelPreferences,
} from "../features/channels/useChannelPreferences";
import { useMainViewEvents } from "../features/events/useMainViewEvents";
import { useUserPresence } from "../features/users/useUserPresence";
import { MattermostApiClient, normalizeServerUrl } from "../mattermostApi";
import { chatDataActions } from "../state/chatDataStore";
import {
	activateChatTab,
	areChatWorkspaceLayoutsEqual,
	type ChatPanelPlacement,
	type ChatWorkspaceState,
	closeChatTab,
	createChatWorkspaceStateFromTabs,
	getPersistedChatWorkspaceTabs,
	getRenderedChannelId,
	getSelectedChannelId,
	openChatTab,
	pinChatTab,
	updateChatWorkspaceLayout,
} from "../state/chatWorkspace";
import {
	chatWorkspaceActions,
	chatWorkspaceStore,
} from "../state/chatWorkspaceStore";
import type { AppStatus } from "../state/uiStore";
import { uiActions, uiStore } from "../state/uiStore";
import { clearConfig, loadConfig, saveConfig } from "../storage";
import type {
	AppSettings,
	ChannelHistoryData,
	MattermostChannel,
	MattermostChannelMember,
	MattermostConfig,
	MattermostFileInfo,
	MattermostPost,
	MattermostReaction,
	MattermostTeam,
	MattermostUser,
	NormalizedState,
	PollProps,
	TypingUsersByChannel,
	WebSocketStatus,
} from "../types";
import { normalizeEmojiName } from "../utils/emoji";
import { fileToUploadItem } from "../utils/fileUpload";
import {
	observeLongTasks,
	startTraceSpan,
	traceEvent,
} from "../utils/perfTrace";
import { createReactionScheduler } from "../utils/reactionScheduler";
import {
	channelLabel,
	includesMention,
	isDirectChannel,
	isTeamChannel,
} from "../utils/format";
import {
	getChannelMembers,
	getDirectChannelUsers,
	getPostUsers,
	getUsersForIds,
	preferredFirstChannel,
} from "../utils/mattermostLoaders";
import {
	applyChannelHistory,
	applyReaction,
	evictInactiveChannelPosts,
	setPostReactions,
	updateChannelLastPostAt,
	updatePost as updatePostInState,
} from "../utils/state";
import { createCallManager } from "../webrtc/CallManager";
import {
	createChatHistoryClient,
	getActiveChatHistoryClient,
	setActiveChatHistoryClient,
} from "../workers/chatHistoryClient";
import { loadChannelHistoryWaterfall } from "../workers/historyWaterfall";
import { ChatShell } from "./ChatShell";
import { electrobun, rendererLog } from "./rpc";

const emptyState: NormalizedState = {
	users: {},
	teams: {},
	channels: {},
	posts: {},
	postOrder: [],
};

const ACTIVITY_REPORT_INTERVAL_MS = 60_000;

function channelHistoryKey(
	serverUrl: string | undefined,
	channelId: string | null,
) {
	return serverUrl && channelId
		? ["channel-history", serverUrl, channelId]
		: null;
}

async function loadChannelHistory(
	api: MattermostApiClient,
	channelId: string,
	currentUserId?: string,
): Promise<ChannelHistoryData> {
	// The worker client owns orchestration when a session is active; the
	// waterfall runs on the main thread otherwise (no session yet, or the
	// worker proved unavailable).
	const historyClient = getActiveChatHistoryClient();
	const { data, hasMore } = historyClient
		? await historyClient.loadChannelHistory(channelId, currentUserId)
		: await loadChannelHistoryWaterfall(api, channelId, currentUserId);
	chatDataActions.setChannelHasMoreHistory(channelId, hasMore);
	return data;
}

function pruneExpiredTypingUsers(
	current: TypingUsersByChannel,
	now: number,
): TypingUsersByChannel {
	let changed = false;
	const next: TypingUsersByChannel = {};

	for (const [channelId, users] of Object.entries(current)) {
		const activeUsers = Object.fromEntries(
			Object.entries(users).filter(([, value]) => value.expiresAt > now),
		);
		if (Object.keys(activeUsers).length > 0) next[channelId] = activeUsers;
		if (Object.keys(activeUsers).length !== Object.keys(users).length)
			changed = true;
	}

	return changed ? next : current;
}

export function MainViewApp() {
	const { cache: swrCache, mutate: mutateSWR } = useSWRConfig();
	useEffect(() => observeLongTasks(), []);
	const reactionSchedulerRef = useRef<ReturnType<typeof createReactionScheduler> | null>(
		null,
	);
	const ui = useSnapshot(uiStore);
	const [config, setConfig] = useState<MattermostConfig | null>(() =>
		loadConfig(),
	);
	const [api, setApi] = useState<MattermostApiClient | null>(null);
	const [currentUser, setCurrentUser] = useState<MattermostUser | null>(null);
	const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
	const chatWorkspace = useSnapshot(chatWorkspaceStore).workspace;
	const activeWorkspaceChannelId = getSelectedChannelId(chatWorkspace);
	const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
		null,
	);
	const standaloneChannelId = activeWorkspaceChannelId
		? null
		: selectedChannelId;
	const renderedChannelId = getRenderedChannelId(
		chatWorkspace,
		standaloneChannelId,
	);
	// Hydrate the workspace store once from persisted config, matching the
	// previous lazy useState initializer (synchronous on first render).
	const workspaceHydratedRef = useRef(false);
	if (!workspaceHydratedRef.current) {
		workspaceHydratedRef.current = true;
		chatWorkspaceActions.replaceWorkspace(
			createChatWorkspaceStateFromTabs(config?.chatWorkspaceTabs),
		);
	}
	const persistChatWorkspaceTabs = useCallback(
		(nextWorkspace: ChatWorkspaceState, baseConfig = config) => {
			if (!baseConfig) return;

			const nextConfig = {
				...baseConfig,
				chatWorkspaceTabs: getPersistedChatWorkspaceTabs(nextWorkspace),
			};
			saveConfig(nextConfig);
			setConfig(nextConfig);
		},
		[config],
	);
	const handleActivateChatTab = useCallback((tabId: string) => {
		const currentWorkspace = chatWorkspaceStore.workspace;
		const nextWorkspace = activateChatTab(currentWorkspace, tabId);
		if (nextWorkspace === currentWorkspace) return;
		// Panel focus is purely local UI state. Persisting it replaces `config`,
		// recreating the Dockview workspace and remounting every timeline.
		chatWorkspaceActions.replaceWorkspace(nextWorkspace);
		// The newly focused panel shows its channel, so any unread flag left on
		// it (e.g. from posts that arrived while another tab was focused) is stale.
		const activatedChannelId = nextWorkspace.tabs[tabId]?.channelId;
		if (activatedChannelId)
			uiActions.clearChannelNotification(activatedChannelId);
	}, []);
	const handleCloseChatTab = useCallback(
		(tabId: string) => {
			const closedTab = chatWorkspaceStore.workspace.tabs[tabId];
			const nextWorkspace = closeChatTab(chatWorkspaceStore.workspace, tabId);
			chatWorkspaceActions.replaceWorkspace(nextWorkspace);
			persistChatWorkspaceTabs(nextWorkspace);
			// Closing the final tab leaves nothing selected; the standalone view
			// shows the empty select-a-conversation screen until the user picks
			// a channel.
			if (closedTab && !nextWorkspace.activeTabId) {
				setSelectedChannelId(null);
			}
			// A closed channel's posts otherwise keep accumulating forever in
			// state.posts whenever the websocket delivers new posts for it (see
			// applyIncomingPost), even though nothing renders them anymore.
			// Drop posts for channels no longer open in a tab or standalone.
			if (closedTab) {
				const remainingChannelIds = new Set(
					Object.values(nextWorkspace.tabs).map((tab) => tab.channelId),
				);
				const standalone = selectedChannelRef.current;
				if (standalone) remainingChannelIds.add(standalone);
				if (!remainingChannelIds.has(closedTab.channelId)) {
					chatWorkspaceActions.forgetView(closedTab.channelId);
					setState((current) =>
						evictInactiveChannelPosts(current, remainingChannelIds),
					);
					// The SWR history cache otherwise keeps this channel's
					// full post history resident forever too: SWR's default
					// cache has no size limit or TTL of its own.
					const key = channelHistoryKey(config?.serverUrl, closedTab.channelId);
					if (key) swrCache.delete(unstable_serialize(key));
				}
			}
		},
		[persistChatWorkspaceTabs],
	);
	const handleCloseActiveChatTab = useCallback(() => {
		const activeTabId = chatWorkspaceStore.workspace.activeTabId;
		if (!activeTabId) return;
		handleCloseChatTab(activeTabId);
	}, [handleCloseChatTab]);
	const handleChatWorkspaceLayoutChange = useCallback(
		(layout: unknown) => {
			const currentWorkspace = chatWorkspaceStore.workspace;
			// Dockview treats a focused panel as a layout change. Its serialized
			// active-panel fields must not cause a config write and workspace rebuild.
			if (areChatWorkspaceLayoutsEqual(currentWorkspace.layout, layout)) return;
			const nextWorkspace = updateChatWorkspaceLayout(currentWorkspace, layout);
			chatWorkspaceActions.replaceWorkspace(nextWorkspace);
			persistChatWorkspaceTabs(nextWorkspace);
		},
		[persistChatWorkspaceTabs],
	);
	const [state, setState] = useState<NormalizedState>(emptyState);
	// Read the latest posts inside the channel-history sync effect without subscribing to every
	// state change (which would re-run the effect on every reaction load).
	const stateRef = useRef(state);
	stateRef.current = state;
	const [envConfig, setEnvConfig] = useState<MattermostConfig | null>(null);
	const [giphyApiKey, setGiphyApiKey] = useState<string | undefined>();
	const {
		archivedChannelSet,
		channelEmojis,
		channelOrder,
		collapsedSections,
		composerHeight,
		favoriteChannelSet,
		sidebarWidth,
		setComposerHeight,
		setSidebarWidth,
		archiveChannel,
		moveChannel,
		setChannelEmoji,
		toggleChannelSection,
		toggleFavoriteChannel,
		unarchiveChannel,
	} = useChannelPreferences();
	const {
		settings,
		setSettings,
		userColors,
		userImages,
		userStatuses,
		setUserColor,
		setUserStatuses,
		resetUserPresence,
	} = useUserPresence({ api, users: state.users });
	const selectedChannelRef = useRef<string | null>(null);
	const previousViewedChannelIdRef = useRef<string | null>(null);
	const previousWsStatusRef = useRef<WebSocketStatus>("idle");
	const websocketHasConnectedRef = useRef(false);
	const reconnectRefreshInFlightRef = useRef(false);
	const lastActivityReportAtRef = useRef(0);
	const activityReportInFlightRef = useRef(false);
	const autoConnectAttemptedRef = useRef(false);
	const composerRef = useRef<MessageComposerHandle>(null);
	const timelinePaintSpanRef = useRef<(() => void) | null>(null);
	const [channelMembers, setChannelMembers] = useState<
		MattermostChannelMember[]
	>([]);
	const [appUpdate, setAppUpdate] = useState<AppUpdateState>({
		status: "idle",
		updateAvailable: false,
		updateReady: false,
	});
	const {
		setAddUserOpen,
		setChannelNotifications,
		setCommandOpen,
		setCreateChannelOpen,
		setCreateDmOpen,
		setEditTarget,
		setError,
		setLoadingHistory,
		setReplyTarget,
		setStatus,
		setTeamUnread,
		setTypingUsers,
		setWsStatus,
	} = uiActions;
	const error = ui.error;
	const loadingHistory = ui.loadingHistory;
	const status: AppStatus = ui.status;
	const [previewAttachment, setPreviewAttachment] =
		useState<MattermostFileInfo | null>(null);

	useEffect(() => {
		selectedChannelRef.current = selectedChannelId;
		if (!activeWorkspaceChannelId) uiActions.resetForChannelChange();
	}, [activeWorkspaceChannelId, selectedChannelId]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			const now = Date.now();
			setTypingUsers((current) => pruneExpiredTypingUsers(current, now));
		}, 1000);
		return () => window.clearInterval(timer);
	}, []);

	useEffect(() => {
		if (!standaloneChannelId || status !== "ready") return;
		const frame = requestAnimationFrame(() => composerRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [standaloneChannelId, status]);

	const reportUserActivity = useCallback(
		(force = false) => {
			if (!api || !currentUser || activityReportInFlightRef.current) return;
			const now = Date.now();
			if (
				!force &&
				now - lastActivityReportAtRef.current < ACTIVITY_REPORT_INTERVAL_MS
			)
				return;

			lastActivityReportAtRef.current = now;
			activityReportInFlightRef.current = true;
			const channelId = selectedChannelRef.current ?? "";
			const previousChannelId = previousViewedChannelIdRef.current;
			void api
				.viewChannel(
					currentUser.id,
					channelId,
					previousChannelId !== channelId ? previousChannelId : undefined,
				)
				.then(() => {
					previousViewedChannelIdRef.current = channelId || null;
					setUserStatuses((current) => {
						const currentStatus = current[currentUser.id];
						if (currentStatus?.status === "dnd") return current;
						return {
							...current,
							[currentUser.id]: {
								...currentStatus,
								user_id: currentUser.id,
								status: "online",
								last_activity_at: now,
							},
						};
					});
				})
				.catch(() => undefined)
				.finally(() => {
					activityReportInFlightRef.current = false;
				});
		},
		[api, currentUser, setUserStatuses],
	);

	useEffect(() => {
		if (!api || !currentUser) return;

		function handleActivity() {
			if (document.visibilityState === "hidden") return;
			reportUserActivity();
		}

		function handleFocus() {
			reportUserActivity(true);
		}

		reportUserActivity(true);

		window.addEventListener("focus", handleFocus);
		window.addEventListener("pointerdown", handleActivity, { capture: true });
		window.addEventListener("keydown", handleActivity, { capture: true });
		window.addEventListener("wheel", handleActivity, { capture: true });
		window.addEventListener("touchstart", handleActivity, { capture: true });
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible" && document.hasFocus()) {
				reportUserActivity();
			}
		}, ACTIVITY_REPORT_INTERVAL_MS);

		return () => {
			window.removeEventListener("focus", handleFocus);
			window.removeEventListener("pointerdown", handleActivity, {
				capture: true,
			});
			window.removeEventListener("keydown", handleActivity, { capture: true });
			window.removeEventListener("wheel", handleActivity, { capture: true });
			window.removeEventListener("touchstart", handleActivity, {
				capture: true,
			});
			window.clearInterval(timer);
		};
	}, [api, currentUser, reportUserActivity]);

	useEffect(() => {
		if (!selectedChannelId || status !== "ready") return;
		reportUserActivity(true);
	}, [reportUserActivity, selectedChannelId, status]);

	const selectedChannelHistoryKey = channelHistoryKey(
		config?.serverUrl,
		standaloneChannelId,
	);
	const selectedChannelHistoryApi = api;
	const selectedChannelHistoryRequest =
		selectedChannelHistoryApi && selectedChannelHistoryKey
			? ([selectedChannelHistoryApi, selectedChannelHistoryKey] as const)
			: null;
	const {
		data: selectedChannelHistory,
		error: selectedChannelHistoryError,
		isLoading: selectedChannelHistoryLoading,
	} = useSWR(
		selectedChannelHistoryRequest,
		([historyApi, [, , channelId]]) =>
			loadChannelHistory(historyApi, channelId, currentUser?.id),
		{
			revalidateOnFocus: false,
		},
	);
	const historyPrefetchSignals = useMemo(
		() => ({
			candidates: Object.keys(state.channels).map((channelId) => ({
				channelId,
				unread: Boolean(ui.channelNotifications[channelId]?.unread),
				mention: Boolean(ui.channelNotifications[channelId]?.mention),
				typing: Object.keys(ui.typingUsers[channelId] ?? {}).length > 0,
			})),
			currentChannelId: renderedChannelId ?? undefined,
			currentUserId: currentUser?.id,
			selectedChannelLoading:
				Boolean(renderedChannelId) &&
				(status === "loading" ||
					(selectedChannelHistoryLoading && !selectedChannelHistory)),
			websocketConnected: ui.wsStatus === "connected",
		}),
		[
			currentUser?.id,
			renderedChannelId,
			selectedChannelHistory,
			selectedChannelHistoryLoading,
			state.channels,
			status,
			ui.channelNotifications,
			ui.typingUsers,
			ui.wsStatus,
		],
	);

	useEffect(() => {
		if (!renderedChannelId || status !== "ready") return;
		getActiveChatHistoryClient()?.recordVisit(renderedChannelId, Date.now());
	}, [renderedChannelId, status]);

	useEffect(() => {
		getActiveChatHistoryClient()?.updateSignals(historyPrefetchSignals);
	}, [historyPrefetchSignals]);

	const mutateChannelHistory = useCallback(
		(
			channelId: string,
			updater: (
				current: ChannelHistoryData | undefined,
			) => ChannelHistoryData | undefined,
		) => {
			const key = channelHistoryKey(config?.serverUrl, channelId);
			if (!key) return;
			void mutateSWR(key, updater, { revalidate: false });
		},
		[config?.serverUrl, mutateSWR],
	);
	const loadPostReactions = useCallback(
		(nextApi: MattermostApiClient, channelId: string, posts: MattermostPost[]) => {
			if (!reactionSchedulerRef.current) {
				reactionSchedulerRef.current = createReactionScheduler({
					api: nextApi,
					apply: (loaded) =>
						setState((current) =>
							loaded.reduce(
								(next, { postId, reactions }) =>
									setPostReactions(next, postId, reactions),
								current,
							),
						),
				});
				reactionSchedulerRef.current.setActiveChannel(channelId);
			}
			reactionSchedulerRef.current.schedule(
				channelId,
				posts.map((post) => post.id),
			);
		},
		[],
	);

	const refreshAfterReconnect = useCallback(async () => {
		if (
			!api ||
			!config ||
			!currentUser ||
			!selectedTeamId ||
			reconnectRefreshInFlightRef.current
		)
			return;

		reconnectRefreshInFlightRef.current = true;
		try {
			const previousChannels = state.channels;
			const channelsForTeam = await api.getChannelsForUserTeam(
				currentUser.id,
				selectedTeamId,
			);
			const channelUsers = await getDirectChannelUsers(
				api,
				channelsForTeam,
				currentUser.id,
			);
			const selectedChannelId = selectedChannelRef.current;
			// The rendered channel is the active workspace tab (or the
			// standalone selection); it must not be re-flagged unread after a
			// reconnect just because the standalone selection went stale.
			const renderedChannelId = getRenderedChannelId(
				chatWorkspaceStore.workspace,
				selectedChannelId,
			);
			const changedChannels = channelsForTeam.filter((channel) => {
				if (channel.id === renderedChannelId) return false;
				const previousLastPostAt =
					previousChannels[channel.id]?.last_post_at ?? 0;
				const nextLastPostAt = channel.last_post_at ?? 0;
				return nextLastPostAt > previousLastPostAt;
			});

			setState((current) => ({
				...current,
				channels: {
					...current.channels,
					...Object.fromEntries(
						channelsForTeam.map((channel) => [channel.id, channel]),
					),
				},
				users: {
					...current.users,
					...Object.fromEntries(channelUsers.map((user) => [user.id, user])),
				},
			}));

			if (selectedChannelId) {
				const history = await loadChannelHistory(
					api,
					selectedChannelId,
					currentUser.id,
				);
				void mutateSWR(
					channelHistoryKey(config.serverUrl, selectedChannelId),
					history,
					{ revalidate: false },
				);
				// The standalone timeline re-reads the mutated cache itself, but
				// while a workspace tab is active nothing reads it, so the
				// refreshed history must be applied to state directly.
				setState((current) => applyChannelHistory(current, history));
			}

			const workspaceChannelIds = new Set(
				Object.values(chatWorkspaceStore.workspace.tabs).map(
					(tab) => tab.channelId,
				),
			);
			workspaceChannelIds.delete(selectedChannelId ?? "");
			await Promise.all(
				[...workspaceChannelIds].map(async (channelId) => {
					try {
						const history = await loadChannelHistory(
							api,
							channelId,
							currentUser.id,
						);
						void mutateSWR(
							channelHistoryKey(config.serverUrl, channelId),
							history,
							{ revalidate: false },
						);
						// postOrder orders the standalone timeline of the
						// selected channel, so background channels must not
						// replace it.
						setState((current) => applyChannelHistory(current, history, false));
					} catch {
						// One unreachable channel must not block the others.
					}
				}),
			);

			if (changedChannels.length > 0) {
				const mentionByChannelId = Object.fromEntries(
					await Promise.all(
						changedChannels.map(async (channel) => {
							const previousLastPostAt =
								previousChannels[channel.id]?.last_post_at ?? 0;
							try {
								const postList = await api.getPostsForChannel(channel.id);
								const mention = Object.values(postList.posts).some(
									(post) =>
										post.create_at > previousLastPostAt &&
										includesMention(post.message, currentUser.username),
								);
								return [channel.id, mention] as const;
							} catch {
								return [channel.id, false] as const;
							}
						}),
					),
				);

				setChannelNotifications((current) => {
					const next = { ...current };
					for (const channel of changedChannels) {
						next[channel.id] = {
							unread: true,
							mention:
								current[channel.id]?.mention ||
								Boolean(mentionByChannelId[channel.id]),
						};
					}
					return next;
				});
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Could not refresh messages after reconnect.",
			);
		} finally {
			reconnectRefreshInFlightRef.current = false;
		}
	}, [api, config, currentUser, mutateSWR, selectedTeamId, state.channels]);

	useEffect(() => {
		if (!api || !standaloneChannelId || !selectedChannelHistory) return;
		setState((current) => applyChannelHistory(current, selectedChannelHistory));
		setChannelMembers(selectedChannelHistory.members);
		setStatus("ready");
		// Only fetch reactions for posts that don't already have them. The history cache
		// never carries reactions, and re-fetching every post on each new message wiped
		// already-loaded reactions and then restored them (flicker).
		const postsWithReactions = new Set(
			Object.values(stateRef.current.posts)
				.filter((post) => post.metadata?.reactions)
				.map((post) => post.id),
		);
		const postsNeedingReactions = Object.values(
			selectedChannelHistory.posts,
		).filter(
			(post) => !post.metadata?.reactions && !postsWithReactions.has(post.id),
		);
		if (postsNeedingReactions.length > 0)
			requestAnimationFrame(() =>
				loadPostReactions(api, standaloneChannelId, postsNeedingReactions),
			);
	}, [api, loadPostReactions, selectedChannelHistory, standaloneChannelId]);

	useEffect(() => {
		if (!standaloneChannelId || !selectedChannelHistoryError) return;
		if (!selectedChannelHistory) setStatus("error");
		setError(
			selectedChannelHistoryError instanceof Error
				? selectedChannelHistoryError.message
				: "Could not load channel.",
		);
	}, [
		standaloneChannelId,
		selectedChannelHistory,
		selectedChannelHistoryError,
	]);

	useEffect(() => {
		if (
			standaloneChannelId &&
			selectedChannelHistoryLoading &&
			!selectedChannelHistory
		)
			setStatus("loading");
	}, [
		standaloneChannelId,
		selectedChannelHistory,
		selectedChannelHistoryLoading,
	]);

	useEffect(() => {
		const previousStatus = previousWsStatusRef.current;
		previousWsStatusRef.current = ui.wsStatus;
		if (ui.wsStatus !== "connected" || previousStatus === "connected") return;
		if (!websocketHasConnectedRef.current) {
			websocketHasConnectedRef.current = true;
			return;
		}
		void refreshAfterReconnect();
	}, [refreshAfterReconnect, ui.wsStatus]);

	const connect = useCallback(
		async (nextConfig: MattermostConfig) => {
			reactionSchedulerRef.current?.reset();
			reactionSchedulerRef.current = null;
			setStatus("loading");
			setError(null);
			setWsStatus("idle");
			previousWsStatusRef.current = "idle";
			websocketHasConnectedRef.current = false;
			reconnectRefreshInFlightRef.current = false;
			void electrobun.rpc?.request.disconnectMattermostWebSocket({});

			const normalizedConfig = {
				...nextConfig,
				serverUrl: normalizeServerUrl(nextConfig.serverUrl),
			};
			const rpc = electrobun.rpc;
			if (!rpc) throw new Error("Mattermost RPC is unavailable.");
			const nextApi = new MattermostApiClient(
				normalizedConfig,
				(request) => rpc.request.mattermostRequest(request),
				(request) => rpc.request.uploadMattermostFiles(request),
				(request) => rpc.request.openMattermostAttachment(request),
			);
			// History loads run in the chat history worker from here on. The
			// broker injects the session credentials main-side; the worker
			// itself never sees the token.
			const historyClient = createChatHistoryClient({
				api: nextApi,
				broker: ({ path, method, body }) =>
					rpc.request.mattermostRequest({
						serverUrl: normalizedConfig.serverUrl,
						token: normalizedConfig.token,
						path,
						method,
						body,
					}),
				log: (message) => rendererLog("chat-history-worker", message),
			});
			historyClient.onBackgroundHistory = (channelId, data) => {
				const key = channelHistoryKey(normalizedConfig.serverUrl, channelId);
				if (key) void mutateSWR(key, data, { revalidate: false });
			};
			historyClient.onChannelMembers = (channelId, membersData) => {
				const key = channelHistoryKey(normalizedConfig.serverUrl, channelId);
				if (key) {
					void mutateSWR(
						key,
						(current: ChannelHistoryData | undefined) =>
							current ? { ...current, ...membersData } : current,
						{ revalidate: false },
					);
				}
				setState((current) => ({
					...current,
					users: {
						...current.users,
						...Object.fromEntries(
							membersData.memberUsers.map((user) => [user.id, user]),
						),
					},
				}));
				if (getRenderedChannelId(chatWorkspaceStore.workspace, null) === channelId)
					setChannelMembers(membersData.members);
			};
			setActiveChatHistoryClient(historyClient);

			try {
				const user = await nextApi.getCurrentUser();
				const teams = await nextApi.getTeamsForCurrentUser();
				const selectedTeam =
					teams.find((team) => team.id === normalizedConfig.lastTeamId) ??
					teams[0];

				let channels: MattermostChannel[] = [];
				let selectedChannel: MattermostChannel | undefined;
				if (selectedTeam) {
					channels = await nextApi.getChannelsForUserTeam(
						user.id,
						selectedTeam.id,
					);
					// Selection is owned by the restored workspace tabs; launching
					// with no tabs starts on the empty select-a-conversation screen
					// instead of resurrecting the last viewed channel.
					const restoredChannelId = getSelectedChannelId(
						chatWorkspaceStore.workspace,
					);
					selectedChannel = restoredChannelId
						? channels.find((channel) => channel.id === restoredChannelId)
						: undefined;
				}

				let posts: Record<string, MattermostPost> = {};
				let postOrder: string[] = [];
				let postUsers: MattermostUser[] = [];
				let memberUsers: MattermostUser[] = [];
				let members: MattermostChannelMember[] = [];
				const channelUsers = await getDirectChannelUsers(
					nextApi,
					channels,
					user.id,
				);
				if (selectedChannel) {
					const restoredWorkspaceChannelIds = new Set(
						Object.values(chatWorkspaceStore.workspace.tabs)
							.map((tab) => tab.channelId)
							.filter((channelId) =>
								channels.some((channel) => channel.id === channelId),
							),
					);
					restoredWorkspaceChannelIds.add(selectedChannel.id);
					const channelHistories = await Promise.all(
						[...restoredWorkspaceChannelIds].map(async (channelId) => {
							const history = await loadChannelHistory(
								nextApi,
								channelId,
								user.id,
							);
							void mutateSWR(
								channelHistoryKey(normalizedConfig.serverUrl, channelId),
								history,
								{ revalidate: false },
							);
							return history;
						}),
					);
					const selectedChannelHistory =
						channelHistories.find((history) =>
							Object.values(history.posts).some(
								(post) => post.channel_id === selectedChannel.id,
							),
						) ?? channelHistories[0];

					posts = Object.assign(
						{},
						...channelHistories.map((history) => history.posts),
					);
					postOrder = selectedChannelHistory?.postOrder ?? [];
					postUsers = channelHistories.flatMap((history) => history.postUsers);
					members = selectedChannelHistory?.members ?? [];
					memberUsers = channelHistories.flatMap(
						(history) => history.memberUsers,
					);
				}

				const savedConfig = {
					...normalizedConfig,
					lastTeamId: selectedTeam?.id,
					lastChannelId: selectedChannel?.id,
				};
				saveConfig(savedConfig);
				setConfig(savedConfig);
				setApi(nextApi);
				setCurrentUser(user);
				setSelectedTeamId(selectedTeam?.id ?? null);
				setSelectedChannelId(selectedChannel?.id ?? null);
				setState({
					users: {
						[user.id]: user,
						...Object.fromEntries(
							channelUsers.map((channelUser) => [channelUser.id, channelUser]),
						),
						...Object.fromEntries(
							postUsers.map((postUser) => [postUser.id, postUser]),
						),
						...Object.fromEntries(
							memberUsers.map((memberUser) => [memberUser.id, memberUser]),
						),
					},
					teams: Object.fromEntries(teams.map((team) => [team.id, team])),
					channels: Object.fromEntries(
						channels.map((channel) => [channel.id, channel]),
					),
					posts,
					postOrder,
				});
				setStatus("ready");
				setChannelMembers(members);
				if (selectedChannel)
					requestAnimationFrame(() =>
						loadPostReactions(nextApi, selectedChannel.id, Object.values(posts)),
					);

				setWsStatus("connecting");
				void electrobun.rpc?.request.connectMattermostWebSocket({
					serverUrl: savedConfig.serverUrl,
					token: savedConfig.token,
				});
			} catch (err) {
				setStatus("error");
				setError(
					err instanceof Error
						? err.message
						: "Could not connect to Mattermost.",
				);
			}
		},
		[loadPostReactions, mutateSWR],
	);

	const passwordLogin = useCallback(
		async (serverUrl: string, loginId: string, password: string) => {
			setStatus("loading");
			setError(null);
			try {
				const rpc = electrobun.rpc;
				if (!rpc) throw new Error("Mattermost RPC is unavailable.");
				const response = await rpc.request.mattermostLogin({
					serverUrl: normalizeServerUrl(serverUrl),
					loginId,
					password,
				});
				if (!response.ok || !response.token) {
					throw new Error(
						response.body &&
							typeof response.body === "object" &&
							"message" in response.body
							? String((response.body as { message?: unknown }).message)
							: `Login failed with ${response.status}.`,
					);
				}
				await connect({
					serverUrl,
					token: response.token,
					authMethod: "password",
				});
			} catch (err) {
				setStatus("error");
				setError(err instanceof Error ? err.message : "Could not sign in.");
			}
		},
		[connect],
	);

	const ssoLogin = useCallback(
		async (serverUrl: string, provider: MattermostSsoProvider) => {
			setStatus("loading");
			setError(null);
			try {
				const rpc = electrobun.rpc;
				if (!rpc) throw new Error("Mattermost RPC is unavailable.");
				const response = await rpc.request.startMattermostSsoLogin({
					serverUrl: normalizeServerUrl(serverUrl),
					provider,
				});
				if (!response.success) {
					throw new Error(response.message ?? "Could not start SSO login.");
				}
			} catch (err) {
				setStatus("error");
				setError(
					err instanceof Error ? err.message : "Could not start SSO login.",
				);
			}
		},
		[],
	);

	useEffect(() => {
		let cancelled = false;
		// Channel selection persists lastChannelId into config; rerunning this effect on config changes reconnects and can replay stale selected channels.
		if (config) {
			void connect(config);
		}

		void electrobun.rpc?.request
			.getEnvConfig({})
			.then((nextEnvConfig) => {
				if (cancelled || !nextEnvConfig) return;
				setGiphyApiKey(nextEnvConfig.giphyApiKey);
				if (config) return;
				if (!nextEnvConfig.serverUrl || !nextEnvConfig.token) return;
				const mattermostEnvConfig = {
					serverUrl: nextEnvConfig.serverUrl,
					token: nextEnvConfig.token,
				};
				setEnvConfig(mattermostEnvConfig);
				if (autoConnectAttemptedRef.current) return;
				autoConnectAttemptedRef.current = true;
				void connect(mattermostEnvConfig);
			})
			.catch(() => {
				if (!cancelled && !config) setEnvConfig(null);
			});

		return () => {
			cancelled = true;
			void electrobun.rpc?.request.disconnectMattermostWebSocket({});
		};
	}, []);

	useEffect(() => {
		void electrobun.rpc?.request.getAppUpdateState({}).then(setAppUpdate);
	}, []);

	const teams = useMemo(() => Object.values(state.teams), [state.teams]);
	const channels = useMemo(
		() =>
			Object.values(state.channels).filter(
				(channel) =>
					isDirectChannel(channel) || channel.team_id === selectedTeamId,
			),
		[state.channels, selectedTeamId],
	);
	const sections = useMemo(() => {
		const activeChannels = channels.filter(
			(channel) => !archivedChannelSet.has(channel.id),
		);
		const favoriteChannels = activeChannels.filter((channel) =>
			favoriteChannelSet.has(channel.id),
		);
		return {
			favorites: favoriteChannels,
			dms: activeChannels.filter(
				(channel) =>
					isDirectChannel(channel) && !favoriteChannelSet.has(channel.id),
			),
			channels: activeChannels.filter(
				(channel) =>
					isTeamChannel(channel) && !favoriteChannelSet.has(channel.id),
			),
			archived: channels.filter((channel) =>
				archivedChannelSet.has(channel.id),
			),
		};
	}, [archivedChannelSet, channels, favoriteChannelSet]);
	const posts = useMemo(
		() =>
			state.postOrder
				.map((id) => state.posts[id])
				.filter(
					(post): post is MattermostPost =>
						Boolean(post) && post.type !== "custom_webrtc_call",
				),
		[state.postOrder, state.posts],
	);
	const workspacePosts = useMemo(
		() =>
			Object.values(state.posts).filter(
				(post) => post.type !== "custom_webrtc_call",
			),
		[state.posts],
	);
	const selectedTeam = selectedTeamId ? state.teams[selectedTeamId] : undefined;
	const selectedChannel = renderedChannelId
		? state.channels[renderedChannelId]
		: undefined;
	const callManager = useMemo(
		() =>
			api && currentUser
				? createCallManager(api, currentUser.id, undefined, {
						devLoopback: settings.devLoopback,
					})
				: null,
		[api, currentUser, settings.devLoopback],
	);

	useEffect(() => {
		return () => callManager?.destroy();
	}, [callManager]);

	async function selectTeam(team: MattermostTeam) {
		if (!api || !currentUser || !config) return;
		setStatus("loading");
		try {
			const channelsForTeam = await api.getChannelsForUserTeam(
				currentUser.id,
				team.id,
			);
			const channelUsers = await getDirectChannelUsers(
				api,
				channelsForTeam,
				currentUser.id,
			);
			const firstChannel = preferredFirstChannel(channelsForTeam);
			const history = firstChannel
				? await loadChannelHistory(api, firstChannel.id, currentUser.id)
				: {
						memberUsers: [],
						members: [],
						postOrder: [],
						posts: {},
						postUsers: [],
					};
			const { memberUsers, members, postOrder, posts, postUsers } = history;
			const nextConfig = {
				...config,
				lastTeamId: team.id,
				lastChannelId: firstChannel?.id,
			};
			saveConfig(nextConfig);
			setConfig(nextConfig);
			if (firstChannel) {
				void mutateSWR(
					channelHistoryKey(config.serverUrl, firstChannel.id),
					history,
					{
						revalidate: false,
					},
				);
			}
			setSelectedTeamId(team.id);
			setSelectedChannelId(firstChannel?.id ?? null);
			setTeamUnread((current) => {
				if (!current[team.id]) return current;
				const next = { ...current };
				delete next[team.id];
				return next;
			});
			setState((current) => ({
				...current,
				channels: {
					...Object.fromEntries(
						Object.values(current.channels)
							.filter(isDirectChannel)
							.map((channel) => [channel.id, channel]),
					),
					...Object.fromEntries(
						channelsForTeam.map((channel) => [channel.id, channel]),
					),
				},
				users: {
					...current.users,
					...Object.fromEntries(channelUsers.map((user) => [user.id, user])),
					...Object.fromEntries(postUsers.map((user) => [user.id, user])),
					...Object.fromEntries(memberUsers.map((user) => [user.id, user])),
				},
				posts,
				postOrder,
			}));
			setChannelMembers(members);
			setStatus("ready");
			if (firstChannel)
				requestAnimationFrame(() =>
					loadPostReactions(api, firstChannel.id, Object.values(posts)),
				);
		} catch (err) {
			setStatus("error");
			setError(err instanceof Error ? err.message : "Could not load team.");
		}
	}

	async function selectChannel(channel: MattermostChannel) {
		if (!api || !config) return;
		reactionSchedulerRef.current?.setActiveChannel(channel.id);
		timelinePaintSpanRef.current?.();
		const endTimelinePaint = startTraceSpan("clickToFirstTimelinePaint");
		timelinePaintSpanRef.current = endTimelinePaint;
		setStatus("loading");
		unarchiveChannel(channel.id);

		const key = channelHistoryKey(config.serverUrl, channel.id);
		const cachedHistory = key
			? (
					swrCache.get(unstable_serialize(key)) as
						| { data?: ChannelHistoryData }
						| undefined
				)?.data
			: undefined;
		traceEvent(cachedHistory ? "channelHistoryCacheHit" : "channelHistoryCacheMiss");
		const nextConfig = { ...config, lastChannelId: channel.id };
		saveConfig(nextConfig);
		setConfig(nextConfig);
		selectedChannelRef.current = channel.id;
		const nextWorkspace = openChatTab(chatWorkspaceStore.workspace, {
			channelId: channel.id,
			teamId: channel.team_id || null,
			title: channelLabel(channel, stateRef.current.users, currentUser?.id),
			temporary: true,
		});
		chatWorkspaceActions.replaceWorkspace(nextWorkspace);
		persistChatWorkspaceTabs(nextWorkspace, nextConfig);
		setSelectedChannelId(channel.id);
		setChannelNotifications((current) => {
			const next = { ...current };
			delete next[channel.id];
			return next;
		});
		const applyFetchedHistory = (history: ChannelHistoryData) => {
			void mutateSWR(channelHistoryKey(config.serverUrl, channel.id), history, {
				revalidate: false,
			});
			setState((current) =>
				applyChannelHistory(
					{
						...current,
						channels: {
							...current.channels,
							[channel.id]: channel,
						},
					},
					history,
				),
			);
			setChannelMembers(history.members);
			setStatus("ready");
			requestAnimationFrame(() => {
				if (timelinePaintSpanRef.current !== endTimelinePaint) return;
				endTimelinePaint();
				timelinePaintSpanRef.current = null;
			});
			const postsNeedingReactions = Object.values(history.posts).filter(
				(post) =>
					!post.metadata?.reactions &&
					!stateRef.current.posts[post.id]?.metadata?.reactions,
			);
			if (postsNeedingReactions.length > 0)
				requestAnimationFrame(() =>
					loadPostReactions(api, channel.id, postsNeedingReactions),
				);
		};

		if (!cachedHistory) {
			applyFetchedHistory(
				await loadChannelHistory(api, channel.id, currentUser?.id),
			);
			return;
		}
		// Cached histories only receive posts that arrived while the channel
		// was selected, so a channel opened into a tab can lag behind the
		// server. Render the cache immediately, then catch up in the background.
		applyFetchedHistory(cachedHistory);
		void loadChannelHistory(api, channel.id, currentUser?.id)
			.then(applyFetchedHistory)
			.catch(() => undefined);
	}

	function pinChannel(channel: MattermostChannel) {
		const workspace = chatWorkspaceStore.workspace;
		const activeTabId = workspace.activeTabId;
		const activeTab = activeTabId ? workspace.tabs[activeTabId] : undefined;
		const nextWorkspace =
			activeTab?.temporary && activeTab.channelId === channel.id
				? pinChatTab(workspace, activeTab.id)
				: openChatTab(workspace, {
						channelId: channel.id,
						teamId: channel.team_id || null,
						title: channelLabel(channel, stateRef.current.users, currentUser?.id),
					});
		chatWorkspaceActions.replaceWorkspace(nextWorkspace);
		persistChatWorkspaceTabs(nextWorkspace);
	}

	async function selectSearchPost(post: MattermostPost) {
		if (!api || !config) return;
		setStatus("loading");
		try {
			const channel =
				state.channels[post.channel_id] ??
				(await api.getChannel(post.channel_id));
			unarchiveChannel(channel.id);
			const postList = await api.getPostThread(post.id).catch(() => ({
				order: [post.id],
				posts: { [post.id]: post },
			}));
			const postUsers = await getPostUsers(
				api,
				Object.values(postList.posts),
				currentUser?.id,
			);
			const members = await getChannelMembers(api, channel.id);
			const memberUsers = await getUsersForIds(
				api,
				members.map((member) => member.user_id),
				currentUser?.id,
			);
			const nextConfig = { ...config, lastChannelId: channel.id };
			saveConfig(nextConfig);
			setConfig(nextConfig);
			setSelectedChannelId(channel.id);
			setChannelNotifications((current) => {
				const next = { ...current };
				delete next[channel.id];
				return next;
			});
			setState((current) => ({
				...current,
				channels: {
					...current.channels,
					[channel.id]: channel,
				},
				users: {
					...current.users,
					...Object.fromEntries(postUsers.map((user) => [user.id, user])),
					...Object.fromEntries(memberUsers.map((user) => [user.id, user])),
				},
				posts: postList.posts,
				postOrder: [...postList.order].reverse(),
			}));
			setChannelMembers(members);
			setStatus("ready");
			requestAnimationFrame(() =>
				loadPostReactions(api, channel.id, Object.values(postList.posts)),
			);
		} catch (err) {
			setStatus("error");
			setError(
				err instanceof Error ? err.message : "Could not load search result.",
			);
		}
	}

	async function sendMessage(
		channelId: string,
		message: string,
		rootId?: string,
		files: File[] = [],
	) {
		if (!api || !currentUser) return;

		try {
			const fileIds =
				files.length > 0
					? (
							await api.uploadFiles(
								channelId,
								await Promise.all(files.map(fileToUploadItem)),
							)
						).file_infos.map((file) => file.id)
					: [];
			const created =
				fileIds.length > 0
					? await api.createPostWithFiles(channelId, message, fileIds, rootId)
					: await api.createPost(channelId, message, rootId);
			setState((current) =>
				updateChannelLastPostAt(current, channelId, created.create_at),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not send message.");
			throw err;
		}
		requestAnimationFrame(() => composerRef.current?.focus());
	}

	async function sendPoll(poll: PollProps) {
		if (!api || !selectedChannelId) return;

		try {
			const created = await api.createPollPost(selectedChannelId, poll);
			setState((current) =>
				updateChannelLastPostAt(current, selectedChannelId, created.create_at),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not create poll.");
			throw err;
		}
		requestAnimationFrame(() => composerRef.current?.focus());
	}

	async function sendTyping(rootId?: string) {
		if (
			!selectedChannelId ||
			(chatWorkspaceStore.chatViewStates[selectedChannelId]?.editTargetId ??
				null)
		) {
			return;
		}
		await electrobun.rpc?.request.sendMattermostTyping({
			channelId: selectedChannelId,
			parentId: rootId,
		});
	}

	async function editMessage(post: MattermostPost, message: string) {
		if (!api || !message.trim() || post.pending) return;
		const previousPost = post;
		const optimisticPost = { ...post, message, update_at: Date.now() };
		setEditTarget(null);
		chatWorkspaceActions.clearEdit(post.channel_id);
		setState((current) => updatePostInState(current, optimisticPost));
		try {
			const updated = await api.updatePost(post.id, message);
			setState((current) => updatePostInState(current, updated));
		} catch (err) {
			setState((current) => updatePostInState(current, previousPost));
			setError(err instanceof Error ? err.message : "Could not edit message.");
		}
		requestAnimationFrame(() => composerRef.current?.focus());
	}

	const openAttachment = useCallback(async (file: MattermostFileInfo) => {
		setPreviewAttachment(file);
	}, []);

	async function openAttachmentExternally(file: MattermostFileInfo) {
		if (!api) return;
		try {
			await api.openAttachment(file);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not open attachment.",
			);
		}
	}

	const toggleReaction = useCallback(
		async (post: MattermostPost, emojiName: string) => {
			if (!api || !currentUser || post.pending) return;
			const normalizedName = normalizeEmojiName(emojiName);
			const existing = post.metadata?.reactions?.some(
				(reaction) =>
					reaction.user_id === currentUser.id &&
					reaction.emoji_name === normalizedName,
			);
			const reaction: MattermostReaction = {
				user_id: currentUser.id,
				post_id: post.id,
				emoji_name: normalizedName,
				create_at: Date.now(),
			};
			setState((current) => applyReaction(current, reaction, existing));
			try {
				if (existing)
					await api.removeReaction(currentUser.id, post.id, normalizedName);
				else await api.addReaction(currentUser.id, post.id, normalizedName);
			} catch {
				setState((current) => applyReaction(current, reaction, !existing));
			}
		},
		[api, currentUser],
	);

	const votePoll = useCallback(
		async (post: MattermostPost, optionId: string) => {
			if (!api || !currentUser || post.pending || !post.props?.poll) return;
			const previousPost = post;
			const nextProps = {
				...post.props,
				poll: {
					...post.props.poll,
					votes: {
						...post.props.poll.votes,
						[currentUser.id]: optionId,
					},
				},
			};
			const optimisticPost = {
				...post,
				props: nextProps,
				update_at: Date.now(),
			};
			setState((current) => updatePostInState(current, optimisticPost));
			try {
				const updated = await api.patchPostProps(post.id, nextProps);
				setState((current) => updatePostInState(current, updated));
			} catch (err) {
				setState((current) => updatePostInState(current, previousPost));
				setError(
					err instanceof Error ? err.message : "Could not vote in poll.",
				);
			}
		},
		[api, currentUser],
	);

	async function loadMoreMessages(
		channelId = selectedChannelRef.current ?? undefined,
	) {
		if (!api || !channelId || loadingHistory) return;

		const isStandaloneChannel = channelId === standaloneChannelId;
		const channelPostIds = isStandaloneChannel
			? state.postOrder
			: Object.values(state.posts)
					.filter((post) => post.channel_id === channelId)
					.sort((left, right) => left.create_at - right.create_at)
					.map((post) => post.id);
		const oldestPostId = channelPostIds[0];
		if (!oldestPostId) return;

		setLoadingHistory(true);
		try {
			const postList = await api.getPostsForChannelBefore(
				channelId,
				oldestPostId,
			);
			chatDataActions.setChannelHasMoreHistory(
				channelId,
				Boolean(postList.prev_post_id),
			);
			const postUsers = await getPostUsers(
				api,
				Object.values(postList.posts),
				currentUser?.id,
			);

			const olderPostOrder = [...postList.order].reverse();
			mutateChannelHistory(channelId, (current) =>
				current
					? {
							...current,
							postUsers: [
								...current.postUsers,
								...postUsers.filter(
									(user) =>
										!current.postUsers.some(
											(currentUser) => currentUser.id === user.id,
										),
								),
							],
							posts: {
								...current.posts,
								...postList.posts,
							},
							postOrder: olderPostOrder.concat(current.postOrder),
						}
					: current,
			);

			setState((current) => ({
				...current,
				users: {
					...current.users,
					...Object.fromEntries(postUsers.map((user) => [user.id, user])),
				},
				posts: {
					...current.posts,
					...postList.posts,
				},
				postOrder: isStandaloneChannel
					? olderPostOrder.concat(current.postOrder)
					: current.postOrder,
			}));

			requestAnimationFrame(() =>
				loadPostReactions(api, channelId, Object.values(postList.posts)),
			);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Could not load more messages.",
			);
		} finally {
			setLoadingHistory(false);
		}
	}

	function openChatPanel(
		channelId: string,
		placement?: ChatPanelPlacement,
		referenceTabId?: string,
	) {
		const channel = stateRef.current.channels[channelId];
		if (!channel) return;
		selectedChannelRef.current = channel.id;
		const nextWorkspace = openChatTab(chatWorkspaceStore.workspace, {
			channelId,
			teamId: channel.team_id || null,
			title: channelLabel(channel, stateRef.current.users, currentUser?.id),
			duplicate: true,
			position:
				placement && referenceTabId ? { referenceTabId, placement } : undefined,
		});
		chatWorkspaceActions.replaceWorkspace(nextWorkspace);
		persistChatWorkspaceTabs(nextWorkspace);
		// The new panel shows this channel immediately, so a stale unread
		// flag (activation short-circuits when the tab is already active)
		// must not survive the open.
		uiActions.clearChannelNotification(channelId);
		// The workspace panel already owns this chat. Updating standalone
		// selection here starts a separate history load and remounts its timeline.
		if (!getSelectedChannelId(chatWorkspaceStore.workspace)) {
			setSelectedChannelId(channel.id);
		}
	}

	function signOut() {
		reactionSchedulerRef.current?.reset();
		reactionSchedulerRef.current = null;
		void electrobun.rpc?.request.disconnectMattermostWebSocket({});
		previousWsStatusRef.current = "idle";
		websocketHasConnectedRef.current = false;
		reconnectRefreshInFlightRef.current = false;
		clearConfig();
		setConfig(null);
		setApi(null);
		setCurrentUser(null);
		setSelectedTeamId(null);
		setSelectedChannelId(null);
		setState(emptyState);
		setStatus("idle");
		setWsStatus("idle");
		setError(null);
		setChannelNotifications({});
		setTeamUnread({});
		setChannelMembers([]);
		resetUserPresence();
		chatDataActions.resetForSignOut();
		chatWorkspaceActions.reset();
		setActiveChatHistoryClient(null);
	}

	function showChannelContextMenu(channel: MattermostChannel) {
		void electrobun.rpc?.request.showChannelContextMenu({
			archived: archivedChannelSet.has(channel.id),
			channelId: channel.id,
			hasEmoji: Boolean(channelEmojis[channel.id]),
			label: channelLabel(channel, state.users, currentUser?.id ?? ""),
		});
	}

	const cancelChatReply = useCallback(
		(channelId: string) => {
			chatWorkspaceActions.clearReply(channelId);
			if (channelId === renderedChannelId) {
				setReplyTarget(null);
			}
		},
		[renderedChannelId],
	);

	const cancelReply = useCallback(() => {
		setReplyTarget(null);
		if (!renderedChannelId) return;
		chatWorkspaceActions.clearReply(renderedChannelId);
	}, [renderedChannelId]);

	const cancelChatEdit = useCallback((channelId: string) => {
		chatWorkspaceActions.clearEdit(channelId);
	}, []);

	const cancelEdit = useCallback(() => {
		setEditTarget(null);
		if (!renderedChannelId) return;
		cancelChatEdit(renderedChannelId);
	}, [cancelChatEdit, renderedChannelId]);

	const setChatDraftMarkdown = useCallback(
		(viewId: string, draftMarkdown: string) => {
			chatWorkspaceActions.setDraft(viewId, draftMarkdown);
		},
		[],
	);
	const setChatComposerHeight = useCallback(
		(viewId: string, height: number) => {
			chatWorkspaceActions.setComposerHeight(viewId, height);
		},
		[],
	);

	const startReply = useCallback((viewId: string, post: MattermostPost) => {
		setEditTarget(null);
		setReplyTarget(post);
		chatWorkspaceActions.setReplyTarget(viewId, post.id);
		requestAnimationFrame(() => composerRef.current?.focus());
	}, []);

	const showMessageContextMenu = useCallback(
		(post: MattermostPost) => {
			if (post.delete_at > 0) return;
			const canEdit = post.user_id === currentUser?.id && !post.pending;
			void electrobun.rpc?.request.showMessageContextMenu({
				postId: post.id,
				canEdit,
				canDelete: canEdit && post.delete_at === 0,
			});
		},
		[currentUser?.id],
	);

	function openSettingsWindow(nextSettings: AppSettings) {
		void electrobun.rpc?.request.openSettingsWindow({ settings: nextSettings });
	}

	function installAppUpdate() {
		void electrobun.rpc?.request.applyAppUpdate({}).then(setAppUpdate);
	}

	async function createChannel(
		displayName: string,
		name: string,
		type: "O" | "P",
	) {
		if (!api || !selectedTeamId) return;
		const created = await api.createChannel(
			selectedTeamId,
			displayName,
			name,
			type,
		);
		setState((current) => ({
			...current,
			channels: { ...current.channels, [created.id]: created },
		}));
		setCreateChannelOpen(false);
		await selectChannel(created);
	}

	async function createDm(userIds: string[]) {
		if (!api || !currentUser) return;
		const uniqueIds = [...new Set([currentUser.id, ...userIds])];
		const created =
			uniqueIds.length > 2
				? await api.createGroupChannel(uniqueIds)
				: await api.createDirectChannel(uniqueIds);
		const users = await getUsersForIds(api, uniqueIds, currentUser.id);
		setState((current) => ({
			...current,
			users: {
				...current.users,
				...Object.fromEntries(users.map((user) => [user.id, user])),
			},
			channels: { ...current.channels, [created.id]: created },
		}));
		setCreateDmOpen(false);
		await selectChannel(created);
	}

	async function addUserToSelectedChannel(userId: string) {
		if (!api || !selectedChannelId) return;
		const member = await api.addChannelMember(selectedChannelId, userId);
		const users = await getUsersForIds(api, [userId], currentUser?.id);
		setState((current) => ({
			...current,
			users: {
				...current.users,
				...Object.fromEntries(users.map((user) => [user.id, user])),
			},
		}));
		setChannelMembers((current) =>
			current.some((item) => item.user_id === member.user_id)
				? current
				: [...current, member],
		);
		setAddUserOpen(false);
	}

	useMainViewEvents({
		api,
		callManager,
		connect,
		currentUser,
		loadPostReactions,
		mutateChannelHistory,
		openSettingsWindow,
		selectedChannelRef,
		settings,
		startReply,
		state,
		setChannelNotifications,
		setCommandOpen,
		setEditTarget,
		setEditTargetId: (post) =>
			chatWorkspaceActions.setEditTarget(post.channel_id, post.id),
		setError,
		setSettings,
		setStatus,
		setState,
		setTypingUsers,
		setAppUpdate,
		setTeamUnread,
		setUserStatuses,
		setWsStatus,
	});

	const resolveImageSrc = useCallback(
		async (src: string) => {
			if (!api) return src;
			return api.getFileDataUrl(src);
		},
		[api],
	);

	// Mirror read-mostly lookup data into the shared chatDataStore so the chat
	// workspace and MUI timeline can consume it via useSnapshot instead of
	// receiving it as drilled props. The React state above remains the producer.
	useEffect(() => {
		chatDataActions.setApi(api);
	}, [api]);
	useEffect(() => {
		chatDataActions.setCurrentUser(currentUser);
	}, [currentUser]);
	useEffect(() => {
		chatDataActions.setUsers(state.users);
	}, [state.users]);
	useEffect(() => {
		chatDataActions.setChannelsById(state.channels);
	}, [state.channels]);
	useEffect(() => {
		chatDataActions.setSettings(settings);
	}, [settings]);
	useEffect(() => {
		chatDataActions.setUserColors(userColors);
	}, [userColors]);
	useEffect(() => {
		chatDataActions.setUserImages(userImages);
	}, [userImages]);
	useEffect(() => {
		chatDataActions.setUserStatuses(userStatuses);
	}, [userStatuses]);
	useEffect(() => {
		chatDataActions.setResolveImageSrc(resolveImageSrc);
	}, [resolveImageSrc]);

	if (!config || !currentUser || status === "idle") {
		return (
			<AuthScreen
				busy={status === "loading"}
				defaultConfig={envConfig ?? config}
				defaultConfigSource={envConfig ? "env" : "saved"}
				error={error}
				onConnect={connect}
				onPasswordLogin={passwordLogin}
				onSsoLogin={ssoLogin}
			/>
		);
	}

	if (!callManager) return null;

	return (
		<CallProvider callManager={callManager}>
			<ChatShell
				api={api}
				channelEmojis={channelEmojis}
				channelMembers={channelMembers}
				channelOrder={channelOrder}
				channels={channels}
				collapsedSections={collapsedSections}
				composerRef={composerRef}
				currentUser={currentUser}
				favoriteChannelSet={favoriteChannelSet}
				giphyApiKey={giphyApiKey}
				composerHeight={composerHeight}
				maxComposerHeight={MAX_COMPOSER_HEIGHT}
				maxSidebarWidth={MAX_SIDEBAR_WIDTH}
				minComposerHeight={MIN_COMPOSER_HEIGHT}
				minSidebarWidth={MIN_SIDEBAR_WIDTH}
				posts={posts}
				workspacePosts={workspacePosts}
				appUpdate={appUpdate}
				sections={sections}
				onActivateChatTab={handleActivateChatTab}
				onCloseActiveChatTab={handleCloseActiveChatTab}
				onCloseChatTab={handleCloseChatTab}
				selectedChannel={selectedChannel}
				selectedChannelId={renderedChannelId}
				selectedTeam={selectedTeam}
				selectedTeamId={selectedTeamId}
				settings={settings}
				sidebarWidth={sidebarWidth}
				teams={teams}
				userColors={userColors}
				userImages={userImages}
				users={state.users}
				userStatuses={userStatuses}
				onAddUserToSelectedChannel={addUserToSelectedChannel}
				onApplyAppUpdate={installAppUpdate}
				onArchiveChannel={archiveChannel}
				onCancelEdit={cancelEdit}
				onCancelReply={cancelReply}
				onCancelChatEdit={cancelChatEdit}
				onCancelChatReply={cancelChatReply}
				onCreateChannel={createChannel}
				onCreateDm={createDm}
				onEditMessage={editMessage}
				onLoadMoreMessages={loadMoreMessages}
				onOpenChatPanel={openChatPanel}
				onMoveChannel={moveChannel}
				onPinChannel={pinChannel}
				onOpenAttachment={openAttachment}
				onOpenSettings={openSettingsWindow}
				onSelectChannel={selectChannel}
				onSelectPost={selectSearchPost}
				onSelectTeam={selectTeam}
				onSendMessage={sendMessage}
				onSendPoll={sendPoll}
				onSendTyping={sendTyping}
				onSetChannelEmoji={setChannelEmoji}
				onSetChatComposerHeight={setChatComposerHeight}
				onSetChatWorkspaceLayout={handleChatWorkspaceLayoutChange}
				onSetComposerHeight={setComposerHeight}
				onSetDraftMarkdown={setChatDraftMarkdown}
				onSetUserColor={setUserColor}
				onSetSidebarWidth={setSidebarWidth}
				onShowChannelContextMenu={showChannelContextMenu}
				onShowMessageContextMenu={showMessageContextMenu}
				onSignOut={signOut}
				onStartReply={startReply}
				onToggleChannelSection={toggleChannelSection}
				onToggleFavoriteChannel={toggleFavoriteChannel}
				onToggleReaction={toggleReaction}
				onUnarchiveChannel={unarchiveChannel}
				onVotePoll={votePoll}
			/>
			<AttachmentPreviewDialog
				api={api}
				file={previewAttachment}
				onClose={() => setPreviewAttachment(null)}
				onOpenExternal={openAttachmentExternally}
			/>
		</CallProvider>
	);
}
