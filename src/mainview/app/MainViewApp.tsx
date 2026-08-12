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
	type ChatPanelPlacement,
	type ChatViewStateByChannel,
	type ChatWorkspaceState,
	closeChatTab,
	createChatWorkspaceStateFromTabs,
	getPersistedChatWorkspaceTabs,
	getSelectedChannelId,
	openChatTab,
	updateChatViewState,
	updateChatWorkspaceLayout,
} from "../state/chatWorkspace";
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
	setPostReactions,
	updateChannelLastPostAt,
	updatePost as updatePostInState,
} from "../utils/state";
import { createCallManager } from "../webrtc/CallManager";
import { ChatShell } from "./ChatShell";
import { electrobun } from "./rpc";

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
	const postList = await api.getPostsForChannel(channelId);
	const posts = postList.posts;
	const postOrder = [...postList.order].reverse();
	const postUsers = await getPostUsers(
		api,
		Object.values(posts),
		currentUserId,
	);
	const members = await getChannelMembers(api, channelId);
	const memberUsers = await getUsersForIds(
		api,
		members.map((member) => member.user_id),
		currentUserId,
	);

	return { memberUsers, members, postOrder, posts, postUsers };
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
	const ui = useSnapshot(uiStore);
	const [config, setConfig] = useState<MattermostConfig | null>(() =>
		loadConfig(),
	);
	const [api, setApi] = useState<MattermostApiClient | null>(null);
	const [currentUser, setCurrentUser] = useState<MattermostUser | null>(null);
	const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
	const [chatWorkspace, setChatWorkspace] = useState(() =>
		createChatWorkspaceStateFromTabs(config?.chatWorkspaceTabs),
	);
	const chatWorkspaceRef = useRef(chatWorkspace);
	chatWorkspaceRef.current = chatWorkspace;
	const activeWorkspaceChannelId = getSelectedChannelId(chatWorkspace);
	const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
		null,
	);
	const standaloneChannelId = activeWorkspaceChannelId
		? null
		: selectedChannelId;
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
	const handleActivateChatTab = useCallback(
		(tabId: string) => {
			const currentWorkspace = chatWorkspaceRef.current;
			const nextWorkspace = activateChatTab(currentWorkspace, tabId);
			if (nextWorkspace === currentWorkspace) return;
			const channelId = getSelectedChannelId(nextWorkspace);
			chatWorkspaceRef.current = nextWorkspace;
			setChatWorkspace(nextWorkspace);
			selectedChannelRef.current = channelId;
			setSelectedChannelId(channelId);
			persistChatWorkspaceTabs(nextWorkspace);
		},
		[persistChatWorkspaceTabs],
	);
	const handleCloseChatTab = useCallback(
		(tabId: string) => {
			const nextWorkspace = closeChatTab(chatWorkspaceRef.current, tabId);
			chatWorkspaceRef.current = nextWorkspace;
			setChatWorkspace(nextWorkspace);
			persistChatWorkspaceTabs(nextWorkspace);
		},
		[persistChatWorkspaceTabs],
	);
	const handleCloseActiveChatTab = useCallback(() => {
		const activeTabId = chatWorkspaceRef.current.activeTabId;
		if (!activeTabId) return;
		handleCloseChatTab(activeTabId);
	}, [handleCloseChatTab]);
	const handleChatWorkspaceLayoutChange = useCallback(
		(layout: unknown) => {
			const nextWorkspace = updateChatWorkspaceLayout(
				chatWorkspaceRef.current,
				layout,
			);
			chatWorkspaceRef.current = nextWorkspace;
			setChatWorkspace(nextWorkspace);
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
	const [channelMembers, setChannelMembers] = useState<
		MattermostChannelMember[]
	>([]);
	const [chatViewStates, setChatViewStates] = useState<ChatViewStateByChannel>(
		{},
	);
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
	const mutateSelectedChannelHistory = useCallback(
		(
			updater: (
				current: ChannelHistoryData | undefined,
			) => ChannelHistoryData | undefined,
		) => {
			const channelId = selectedChannelRef.current;
			if (!channelId) return;
			mutateChannelHistory(channelId, updater);
		},
		[mutateChannelHistory],
	);

	const loadPostReactions = useCallback(
		async (nextApi: MattermostApiClient, posts: MattermostPost[]) => {
			await Promise.all(
				posts.map(async (post) => {
					try {
						const reactions = await nextApi.getReactionsForPost(post.id);
						setState((current) =>
							setPostReactions(current, post.id, reactions),
						);
					} catch {
						// Reactions are additive UI. A server that rejects the endpoint should not block chat.
					}
				}),
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
			const changedChannels = channelsForTeam.filter((channel) => {
				if (channel.id === selectedChannelId) return false;
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
			}

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
			void loadPostReactions(api, postsNeedingReactions);
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
					selectedChannel =
						channels.find(
							(channel) => channel.id === normalizedConfig.lastChannelId,
						) ?? preferredFirstChannel(channels);
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
						Object.values(chatWorkspaceRef.current.tabs)
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
				void loadPostReactions(nextApi, Object.values(posts));

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
	const renderedChannelId = activeWorkspaceChannelId ?? selectedChannelId;
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
			void loadPostReactions(api, Object.values(posts));
		} catch (err) {
			setStatus("error");
			setError(err instanceof Error ? err.message : "Could not load team.");
		}
	}

	async function selectChannel(channel: MattermostChannel) {
		if (!api || !config) return;
		unarchiveChannel(channel.id);

		const key = channelHistoryKey(config.serverUrl, channel.id);
		const cachedHistory = key
			? (
					swrCache.get(unstable_serialize(key)) as
						| { data?: ChannelHistoryData }
						| undefined
				)?.data
			: undefined;
		const nextConfig = { ...config, lastChannelId: channel.id };
		saveConfig(nextConfig);
		setConfig(nextConfig);
		selectedChannelRef.current = channel.id;
		const nextWorkspace = openChatTab(chatWorkspaceRef.current, {
			channelId: channel.id,
			teamId: channel.team_id || null,
			title: channelLabel(channel, stateRef.current.users, currentUser?.id),
		});
		chatWorkspaceRef.current = nextWorkspace;
		setChatWorkspace(nextWorkspace);
		persistChatWorkspaceTabs(nextWorkspace, nextConfig);
		setSelectedChannelId(channel.id);
		setChannelNotifications((current) => {
			const next = { ...current };
			delete next[channel.id];
			return next;
		});
		const fetchedHistory = cachedHistory
			? cachedHistory
			: await loadChannelHistory(api, channel.id, currentUser?.id);
		void mutateSWR(
			channelHistoryKey(config.serverUrl, channel.id),
			fetchedHistory,
			{ revalidate: false },
		);
		setState((current) =>
			applyChannelHistory(
				{
					...current,
					channels: {
						...current.channels,
						[channel.id]: channel,
					},
				},
				fetchedHistory,
			),
		);
		if (fetchedHistory) setChannelMembers(fetchedHistory.members);
		setStatus(fetchedHistory ? "ready" : "loading");
		if (fetchedHistory)
			void loadPostReactions(api, Object.values(fetchedHistory.posts));
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
			void loadPostReactions(api, Object.values(postList.posts));
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
			(chatViewStates[selectedChannelId]?.editTargetId ?? null)
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
		setChatViewStates((current) =>
			updateChatViewState(current, post.channel_id, (state) => ({
				...state,
				editTargetId: null,
			})),
		);
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

			void loadPostReactions(api, Object.values(postList.posts));
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
		const nextWorkspace = openChatTab(chatWorkspaceRef.current, {
			channelId,
			teamId: channel.team_id || null,
			title: channelLabel(channel, stateRef.current.users, currentUser?.id),
			duplicate: true,
			position:
				placement && referenceTabId ? { referenceTabId, placement } : undefined,
		});
		chatWorkspaceRef.current = nextWorkspace;
		setChatWorkspace(nextWorkspace);
		persistChatWorkspaceTabs(nextWorkspace);
		setSelectedChannelId(channel.id);
	}

	function signOut() {
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
			setChatViewStates((current) =>
				updateChatViewState(current, channelId, (state) => ({
					...state,
					replyTargetId: null,
				})),
			);
			if (channelId === renderedChannelId) {
				setReplyTarget(null);
			}
		},
		[renderedChannelId],
	);

	const cancelReply = useCallback(() => {
		setReplyTarget(null);
		if (!renderedChannelId) return;
		setChatViewStates((current) =>
			updateChatViewState(current, renderedChannelId, (state) => ({
				...state,
				replyTargetId: null,
			})),
		);
	}, [renderedChannelId]);

	const cancelChatEdit = useCallback((channelId: string) => {
		setChatViewStates((current) =>
			updateChatViewState(current, channelId, (state) => ({
				...state,
				editTargetId: null,
			})),
		);
	}, []);

	const cancelEdit = useCallback(() => {
		setEditTarget(null);
		if (!renderedChannelId) return;
		cancelChatEdit(renderedChannelId);
	}, [cancelChatEdit, renderedChannelId]);

	const setChatDraftMarkdown = useCallback(
		(viewId: string, draftMarkdown: string) => {
			setChatViewStates((current) =>
				updateChatViewState(current, viewId, (state) => ({
					...state,
					draftMarkdown,
				})),
			);
		},
		[],
	);
	const setChatComposerHeight = useCallback(
		(viewId: string, height: number) => {
			setChatViewStates((current) =>
				updateChatViewState(current, viewId, (state) => ({
					...state,
					composerHeight: height,
				})),
			);
		},
		[],
	);

	const startReply = useCallback((viewId: string, post: MattermostPost) => {
		setEditTarget(null);
		setReplyTarget(post);
		setChatViewStates((current) =>
			updateChatViewState(current, viewId, (state) => ({
				...state,
				editTargetId: null,
				replyTargetId: post.id,
			})),
		);
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
		mutateSelectedChannelHistory,
		openSettingsWindow,
		selectedChannelRef,
		settings,
		startReply,
		state,
		setChannelNotifications,
		setCommandOpen,
		setEditTarget,
		setEditTargetId: (post) =>
			setChatViewStates((current) =>
				updateChatViewState(current, post.channel_id, (state) => ({
					...state,
					editTargetId: post.id,
					replyTargetId: null,
				})),
			),
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
				defaultConfig={envConfig}
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
				chatWorkspace={chatWorkspace}
				chatViewStates={chatViewStates}
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
