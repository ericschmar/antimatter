import "react-resizable/css/styles.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { unstable_serialize, useSWRConfig } from "swr";
import { useSnapshot } from "valtio";
import { AuthScreen } from "../components/AuthScreen";
import type { MessageComposerHandle } from "../components/MessageComposer";
import { MattermostApiClient, normalizeServerUrl } from "../mattermostApi";
import { clearConfig, loadConfig, saveConfig } from "../storage";
import type { MattermostSsoProvider } from "../../shared/electrobunRpc";
import type {
	AppSettings,
	ChannelHistoryData,
	MattermostChannelMember,
	MattermostChannel,
	MattermostConfig,
	MattermostFileInfo,
	MattermostPost,
	MattermostReaction,
	MattermostTeam,
	MattermostUser,
	NormalizedState,
	TypingUsersByChannel,
} from "../types";
import { channelLabel, isDirectChannel, isTeamChannel } from "../utils/format";
import { normalizeEmojiName } from "../utils/emoji";
import {
	addPost,
	applyReaction,
	replacePost,
	setPostReactions,
	updatePost as updatePostInState,
	updateChannelLastPostAt,
} from "../utils/state";
import { fileToUploadItem } from "../utils/fileUpload";
import {
	getChannelMembers,
	getDirectChannelUsers,
	getPostUsers,
	getUsersForIds,
	preferredFirstChannel,
} from "../utils/mattermostLoaders";
import { electrobun } from "./rpc";
import {
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	useChannelPreferences,
} from "../features/channels/useChannelPreferences";
import { useUserPresence } from "../features/users/useUserPresence";
import { useMainViewEvents } from "../features/events/useMainViewEvents";
import { ChatShell } from "./ChatShell";
import { uiActions, uiStore } from "../state/uiStore";
import type { AppStatus } from "../state/uiStore";
import type { AppUpdateState } from "../../shared/electrobunRpc";

const emptyState: NormalizedState = {
	users: {},
	teams: {},
	channels: {},
	posts: {},
	postOrder: [],
};

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

function normalizedHistoryState(history: ChannelHistoryData): NormalizedState {
	return {
		channels: {},
		posts: history.posts,
		postOrder: history.postOrder,
		teams: {},
		users: {},
	};
}

function addPostToHistory(
	history: ChannelHistoryData | undefined,
	post: MattermostPost,
): ChannelHistoryData | undefined {
	if (!history) return history;
	const next = addPost(normalizedHistoryState(history), post);
	if (next.posts === history.posts && next.postOrder === history.postOrder)
		return history;
	return {
		...history,
		posts: next.posts,
		postOrder: next.postOrder,
	};
}

function replacePostInHistory(
	history: ChannelHistoryData | undefined,
	oldId: string,
	post: MattermostPost,
): ChannelHistoryData | undefined {
	if (!history) return history;
	const next = replacePost(normalizedHistoryState(history), oldId, post);
	return {
		...history,
		posts: next.posts,
		postOrder: next.postOrder,
	};
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
	const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
		null,
	);
	const [state, setState] = useState<NormalizedState>(emptyState);
	const [envConfig, setEnvConfig] = useState<MattermostConfig | null>(null);
	const {
		archivedChannelSet,
		channelEmojis,
		channelOrder,
		collapsedSections,
		favoriteChannelSet,
		sidebarWidth,
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
		setUserStatuses,
		resetUserPresence,
	} = useUserPresence({ api, users: state.users });
	const selectedChannelRef = useRef<string | null>(null);
	const autoConnectAttemptedRef = useRef(false);
	const composerRef = useRef<MessageComposerHandle>(null);
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
		setTypingUsers,
		setWsStatus,
	} = uiActions;
	const editTarget = ui.editTarget as MattermostPost | null;
	const error = ui.error;
	const loadingHistory = ui.loadingHistory;
	const status: AppStatus = ui.status;

	useEffect(() => {
		selectedChannelRef.current = selectedChannelId;
		uiActions.resetForChannelChange();
	}, [selectedChannelId]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			const now = Date.now();
			setTypingUsers((current) => pruneExpiredTypingUsers(current, now));
		}, 1000);
		return () => window.clearInterval(timer);
	}, []);

	useEffect(() => {
		if (!selectedChannelId || status !== "ready") return;
		const frame = requestAnimationFrame(() => composerRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [selectedChannelId, status]);

	const selectedChannelHistoryKey = channelHistoryKey(
		config?.serverUrl,
		selectedChannelId,
	);
	const {
		data: selectedChannelHistory,
		error: selectedChannelHistoryError,
		isLoading: selectedChannelHistoryLoading,
	} = useSWR(
		api ? selectedChannelHistoryKey : null,
		([, , channelId]: [string, string, string]) =>
			loadChannelHistory(api!, channelId, currentUser?.id),
		{
			revalidateOnFocus: false,
		},
	);

	const mutateSelectedChannelHistory = useCallback(
		(
			updater: (
				current: ChannelHistoryData | undefined,
			) => ChannelHistoryData | undefined,
		) => {
			const key = channelHistoryKey(config?.serverUrl, selectedChannelId);
			if (!key) return;
			void mutateSWR(key, updater, { revalidate: false });
		},
		[config?.serverUrl, mutateSWR, selectedChannelId],
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

	useEffect(() => {
		if (!api || !selectedChannelId || !selectedChannelHistory) return;
		setState((current) => ({
			...current,
			users: {
				...current.users,
				...Object.fromEntries(
					selectedChannelHistory.postUsers.map((user) => [user.id, user]),
				),
				...Object.fromEntries(
					selectedChannelHistory.memberUsers.map((user) => [user.id, user]),
				),
			},
			posts: selectedChannelHistory.posts,
			postOrder: selectedChannelHistory.postOrder,
		}));
		setChannelMembers(selectedChannelHistory.members);
		setStatus("ready");
		void loadPostReactions(api, Object.values(selectedChannelHistory.posts));
	}, [api, loadPostReactions, selectedChannelHistory, selectedChannelId]);

	useEffect(() => {
		if (!selectedChannelHistoryError) return;
		if (!selectedChannelHistory) setStatus("error");
		setError(
			selectedChannelHistoryError instanceof Error
				? selectedChannelHistoryError.message
				: "Could not load channel.",
		);
	}, [selectedChannelHistory, selectedChannelHistoryError]);

	useEffect(() => {
		if (selectedChannelHistoryLoading && !selectedChannelHistory)
			setStatus("loading");
	}, [selectedChannelHistory, selectedChannelHistoryLoading]);

	const connect = useCallback(
		async (nextConfig: MattermostConfig) => {
			setStatus("loading");
			setError(null);
			setWsStatus("idle");
			void electrobun.rpc!.request.disconnectMattermostWebSocket({});

			const normalizedConfig = {
				...nextConfig,
				serverUrl: normalizeServerUrl(nextConfig.serverUrl),
			};
			const nextApi = new MattermostApiClient(
				normalizedConfig,
				(request) => electrobun.rpc!.request.mattermostRequest(request),
				(request) => electrobun.rpc!.request.uploadMattermostFiles(request),
				(request) => electrobun.rpc!.request.openMattermostAttachment(request),
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
					const history = await loadChannelHistory(
						nextApi,
						selectedChannel.id,
						user.id,
					);
					posts = history.posts;
					postOrder = history.postOrder;
					postUsers = history.postUsers;
					members = history.members;
					memberUsers = history.memberUsers;
					void mutateSWR(
						channelHistoryKey(normalizedConfig.serverUrl, selectedChannel.id),
						history,
						{ revalidate: false },
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
				void electrobun.rpc!.request.connectMattermostWebSocket({
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
				const response = await electrobun.rpc!.request.mattermostLogin({
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
				const response = await electrobun.rpc!.request.startMattermostSsoLogin({
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
		if (config) {
			void connect(config);
			return () => {
				void electrobun.rpc!.request.disconnectMattermostWebSocket({});
			};
		}

		void electrobun.rpc!.request.getEnvConfig({}).then((nextEnvConfig) => {
			if (!nextEnvConfig) return;
			setEnvConfig(nextEnvConfig);
			if (autoConnectAttemptedRef.current) return;
			autoConnectAttemptedRef.current = true;
			void connect(nextEnvConfig);
		});

		return () => {
			void electrobun.rpc!.request.disconnectMattermostWebSocket({});
		};
	}, []);

	useEffect(() => {
		void electrobun.rpc!.request.getAppUpdateState({}).then(setAppUpdate);
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
		() => state.postOrder.map((id) => state.posts[id]).filter(Boolean),
		[state.postOrder, state.posts],
	);
	const selectedTeam = selectedTeamId ? state.teams[selectedTeamId] : undefined;
	const selectedChannel = selectedChannelId
		? state.channels[selectedChannelId]
		: undefined;

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
			users: cachedHistory
				? {
						...current.users,
						...Object.fromEntries(
							cachedHistory.postUsers.map((user) => [user.id, user]),
						),
						...Object.fromEntries(
							cachedHistory.memberUsers.map((user) => [user.id, user]),
						),
					}
				: current.users,
			posts: cachedHistory?.posts ?? {},
			postOrder: cachedHistory?.postOrder ?? [],
		}));
		setChannelMembers(cachedHistory?.members ?? []);
		setStatus(cachedHistory ? "ready" : "loading");
	}

	async function selectSearchPost(post: MattermostPost) {
		if (!api || !config) return;
		setStatus("loading");
		try {
			const channel =
				state.channels[post.channel_id] ??
				(await api.getChannel(post.channel_id));
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
		message: string,
		rootId?: string,
		files: File[] = [],
	) {
		if (!api || !currentUser || !selectedChannelId) return;
		const clientId = crypto.randomUUID();
		const pendingFiles: MattermostFileInfo[] = files.map((file, index) => ({
			id: `${clientId}-file-${index}`,
			name: file.name,
			mime_type: file.type,
			extension: file.name.split(".").pop(),
			has_preview_image: file.type.startsWith("image/"),
		}));
		const pendingPost: MattermostPost = {
			id: clientId,
			client_id: clientId,
			channel_id: selectedChannelId,
			user_id: currentUser.id,
			create_at: Date.now(),
			update_at: Date.now(),
			delete_at: 0,
			message,
			root_id: rootId,
			metadata: pendingFiles.length > 0 ? { files: pendingFiles } : undefined,
			pending: true,
		};
		setReplyTarget(null);
		mutateSelectedChannelHistory((current) =>
			addPostToHistory(current, pendingPost),
		);
		setState((current) =>
			updateChannelLastPostAt(
				addPost(current, pendingPost),
				selectedChannelId,
				pendingPost.create_at,
			),
		);

		try {
			const fileIds =
				files.length > 0
					? (
							await api.uploadFiles(
								selectedChannelId,
								await Promise.all(files.map(fileToUploadItem)),
							)
						).file_infos.map((file) => file.id)
					: [];
			const created =
				fileIds.length > 0
					? await api.createPostWithFiles(
							selectedChannelId,
							message,
							fileIds,
							rootId,
						)
					: await api.createPost(selectedChannelId, message, rootId);
			mutateSelectedChannelHistory((current) =>
				replacePostInHistory(current, clientId, created),
			);
			setState((current) =>
				updateChannelLastPostAt(
					replacePost(current, clientId, created),
					selectedChannelId,
					created.create_at,
				),
			);
		} catch {
			const failedPost = { ...pendingPost, pending: false, failed: true };
			mutateSelectedChannelHistory((current) =>
				current
					? {
							...current,
							posts: { ...current.posts, [clientId]: failedPost },
						}
					: current,
			);
			setState((current) => ({
				...current,
				posts: {
					...current.posts,
					[clientId]: failedPost,
				},
			}));
		}
		requestAnimationFrame(() => composerRef.current?.focus());
	}

	async function sendTyping(rootId?: string) {
		if (!selectedChannelId || editTarget) return;
		await electrobun.rpc!.request.sendMattermostTyping({
			channelId: selectedChannelId,
			parentId: rootId,
		});
	}

	async function editMessage(post: MattermostPost, message: string) {
		if (!api || !message.trim() || post.pending) return;
		const previousPost = post;
		const optimisticPost = { ...post, message, update_at: Date.now() };
		setEditTarget(null);
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

	async function openAttachment(file: MattermostFileInfo) {
		if (!api) return;
		try {
			await api.openAttachment(file);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not open attachment.");
		}
	}

	async function toggleReaction(post: MattermostPost, emojiName: string) {
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
	}

	async function loadMoreMessages() {
		if (
			!api ||
			!selectedChannelId ||
			loadingHistory ||
			state.postOrder.length === 0
		)
			return;

		setLoadingHistory(true);
		try {
			// Get the oldest post ID from the current postOrder (first item since it's reversed)
			const oldestPostId = state.postOrder[0];
			if (!oldestPostId) return;

			const postList = await api.getPostsForChannelBefore(
				selectedChannelId,
				oldestPostId,
			);
			const postUsers = await getPostUsers(
				api,
				Object.values(postList.posts),
				currentUser?.id,
			);

			const olderPostOrder = [...postList.order].reverse();
			mutateSelectedChannelHistory((current) =>
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
				postOrder: olderPostOrder.concat(current.postOrder),
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

	function signOut() {
		void electrobun.rpc!.request.disconnectMattermostWebSocket({});
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
		setChannelMembers([]);
		resetUserPresence();
	}

	function showChannelContextMenu(channel: MattermostChannel) {
		void electrobun.rpc!.request.showChannelContextMenu({
			archived: archivedChannelSet.has(channel.id),
			channelId: channel.id,
			hasEmoji: Boolean(channelEmojis[channel.id]),
			label: channelLabel(channel, state.users, currentUser?.id ?? ""),
		});
	}

	function startReply(post: MattermostPost) {
		setEditTarget(null);
		setReplyTarget(post);
		requestAnimationFrame(() => composerRef.current?.focus());
	}

	function showMessageContextMenu(post: MattermostPost) {
		void electrobun.rpc!.request.showMessageContextMenu({
			postId: post.id,
			canEdit: post.user_id === currentUser?.id && !post.pending,
		});
	}

	function openSettingsWindow(nextSettings: AppSettings) {
		void electrobun.rpc!.request.openSettingsWindow({ settings: nextSettings });
	}

	function installAppUpdate() {
		void electrobun.rpc!.request.applyAppUpdate({}).then(setAppUpdate);
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
		setError,
		setSettings,
		setStatus,
		setState,
		setTypingUsers,
		setAppUpdate,
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

	return (
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
				maxSidebarWidth={MAX_SIDEBAR_WIDTH}
				minSidebarWidth={MIN_SIDEBAR_WIDTH}
				posts={posts}
				appUpdate={appUpdate}
				resolveImageSrc={resolveImageSrc}
				sections={sections}
				selectedChannel={selectedChannel}
			selectedChannelId={selectedChannelId}
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
			onCancelEdit={() => setEditTarget(null)}
			onCancelReply={() => setReplyTarget(null)}
			onCreateChannel={createChannel}
			onCreateDm={createDm}
			onEditMessage={editMessage}
			onLoadMoreMessages={loadMoreMessages}
			onMoveChannel={moveChannel}
			onOpenAttachment={openAttachment}
			onOpenSettings={openSettingsWindow}
			onSelectChannel={selectChannel}
			onSelectPost={selectSearchPost}
				onSelectTeam={selectTeam}
				onSendMessage={sendMessage}
				onSendTyping={sendTyping}
				onSetChannelEmoji={setChannelEmoji}
				onSetSidebarWidth={setSidebarWidth}
			onShowChannelContextMenu={showChannelContextMenu}
			onShowMessageContextMenu={showMessageContextMenu}
			onSignOut={signOut}
			onStartReply={startReply}
			onToggleChannelSection={toggleChannelSection}
			onToggleFavoriteChannel={toggleFavoriteChannel}
			onToggleReaction={toggleReaction}
			onUnarchiveChannel={unarchiveChannel}
		/>
	);
}
