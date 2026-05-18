import Electrobun, { Electroview } from "electrobun/view";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Resizable, type ResizeCallbackData } from "react-resizable";
import "react-resizable/css/styles.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { createRoot } from "react-dom/client";
import { AuthScreen } from "./components/AuthScreen";
import {
	MessageComposer,
	type MessageComposerHandle,
} from "./components/MessageComposer";
import { MessageTimeline } from "./components/MessageTimeline";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import { MattermostApiClient, normalizeServerUrl } from "./mattermostApi";
import {
	loadSettings,
	clearConfig,
	loadArchivedChannelIds,
	loadChannelEmojis,
	loadChannelOrder,
	loadConfig,
	loadFavoriteChannelIds,
	loadUserColorPaletteVersion,
	loadUserColors,
	saveChannelEmojis,
	saveChannelOrder,
	saveConfig,
	saveArchivedChannelIds,
	saveFavoriteChannelIds,
	saveSettings,
	saveUserColorPaletteVersion,
	saveUserColors,
} from "./storage";
import type { MattermostClientRPC } from "../shared/electrobunRpc";
import type {
	ChannelNotificationState,
	ChannelSectionKey,
	AppSettings,
	MattermostChannelMember,
	MattermostChannel,
	MattermostConfig,
	MattermostFileInfo,
	MattermostPost,
	MattermostReaction,
	MattermostTeam,
	MattermostUser,
	MattermostUserStatus,
	NormalizedState,
	WebSocketStatus,
} from "./types";
import {
	channelLabel,
	directChannelOtherUserId,
	includesMention,
	initials,
	isDirectChannel,
	isTeamChannel,
	userLabel,
} from "./utils/format";
import { normalizeEmojiName } from "./utils/emoji";
import {
	addPost,
	applyReaction,
	mergeUsers,
	replacePost,
	setPostReactions,
	updatePost as updatePostInState,
	updateChannelLastPostAt,
} from "./utils/state";
import "./index.css";

const DEFAULT_SIDEBAR_WIDTH = 248;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 420;
const USER_COLOR_PALETTE_VERSION = "2";
const USER_COLOR_PALETTE = [
	"#7dd3fc",
	"#fda4af",
	"#86efac",
	"#fcd34d",
	"#c4b5fd",
	"#f9a8d4",
	"#5eead4",
	"#fdba74",
	"#a5b4fc",
	"#bef264",
	"#f0abfc",
	"#93c5fd",
	"#fb7185",
	"#38bdf8",
	"#4ade80",
	"#facc15",
	"#a78bfa",
	"#f472b6",
	"#2dd4bf",
	"#fb923c",
	"#818cf8",
	"#a3e635",
	"#e879f9",
	"#60a5fa",
	"#f87171",
	"#22d3ee",
	"#34d399",
	"#eab308",
	"#c084fc",
	"#ec4899",
	"#14b8a6",
	"#f97316",
	"#6366f1",
	"#84cc16",
	"#d946ef",
	"#3b82f6",
];

const rpc = Electroview.defineRPC<MattermostClientRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {},
		messages: {
			mattermostWebSocketStatus: ({ status, message }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-status", {
						detail: { status, message },
					}),
				);
			},
			mattermostWebSocketPost: ({ post }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-post", {
						detail: { post },
					}),
				);
			},
			mattermostWebSocketReaction: ({ reaction, removed }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-reaction", {
						detail: { reaction, removed },
					}),
				);
			},
			mattermostWebSocketStatusChange: ({ status }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-status-change", {
						detail: { status },
					}),
				);
			},
			channelContextMenuAction: (action) => {
				window.dispatchEvent(
					new CustomEvent("channel-context-menu-action", {
						detail: action,
					}),
				);
			},
			messageContextMenuAction: (action) => {
				window.dispatchEvent(
					new CustomEvent("message-context-menu-action", {
						detail: action,
					}),
				);
			},
			applicationMenuAction: (action) => {
				window.dispatchEvent(
					new CustomEvent("application-menu-action", {
						detail: action,
					}),
				);
			},
			settingsUpdated: ({ settings }) => {
				window.dispatchEvent(
					new CustomEvent("settings-updated", {
						detail: { settings },
					}),
				);
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

const emptyState: NormalizedState = {
	users: {},
	teams: {},
	channels: {},
	posts: {},
	postOrder: [],
};

function App() {
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
	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
		"idle",
	);
	const [wsStatus, setWsStatus] = useState<WebSocketStatus>("idle");
	const [error, setError] = useState<string | null>(null);
	const [envConfig, setEnvConfig] = useState<MattermostConfig | null>(null);
	const [favoriteChannelIds, setFavoriteChannelIds] = useState<string[]>(() =>
		loadFavoriteChannelIds(),
	);
	const [archivedChannelIds, setArchivedChannelIds] = useState<string[]>(() =>
		loadArchivedChannelIds(),
	);
	const [channelEmojis, setChannelEmojis] = useState<Record<string, string>>(
		() => loadChannelEmojis(),
	);
	const [channelOrder, setChannelOrder] = useState<Record<string, string[]>>(
		() => loadChannelOrder(),
	);
	const [userColors, setUserColors] = useState<Record<string, string>>(() =>
		loadUserColors(),
	);
	const [userImages, setUserImages] = useState<Record<string, string>>({});
	const [userStatuses, setUserStatuses] = useState<Record<string, MattermostUserStatus>>({});
	const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
	const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
	const [channelNotifications, setChannelNotifications] =
		useState<ChannelNotificationState>({});
	const [collapsedSections, setCollapsedSections] = useState<
		Record<ChannelSectionKey, boolean>
	>({
		favorites: false,
		channels: false,
		dms: false,
		archived: true,
	});
	const selectedChannelRef = useRef<string | null>(null);
	const autoConnectAttemptedRef = useRef(false);
	const composerRef = useRef<MessageComposerHandle>(null);
	const [replyTarget, setReplyTarget] = useState<MattermostPost | null>(null);
	const [editTarget, setEditTarget] = useState<MattermostPost | null>(null);
	const [channelMembers, setChannelMembers] = useState<MattermostChannelMember[]>([]);
	const [commandOpen, setCommandOpen] = useState(false);
	const [createChannelOpen, setCreateChannelOpen] = useState(false);
	const [createDmOpen, setCreateDmOpen] = useState(false);
	const [addUserOpen, setAddUserOpen] = useState(false);

	useEffect(() => {
		selectedChannelRef.current = selectedChannelId;
		setReplyTarget(null);
		setEditTarget(null);
	}, [selectedChannelId]);

	useEffect(() => {
		if (!selectedChannelId || status !== "ready") return;
		const frame = requestAnimationFrame(() => composerRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [selectedChannelId, status]);

	useEffect(() => {
		const userIds = Object.keys(state.users);
		if (userIds.length === 0) return;
		const shouldMigratePalette =
			loadUserColorPaletteVersion() !== USER_COLOR_PALETTE_VERSION;

		setUserColors((current) => {
			let changed = false;
			const next = { ...current };
			const usedColors = new Set(
				shouldMigratePalette ? [] : Object.values(current),
			);
			for (const userId of [...userIds].sort()) {
				const existingColor = next[userId];
				if (!shouldMigratePalette && existingColor) {
					usedColors.add(existingColor);
					continue;
				}
				const color = colorForUserId(userId, usedColors);
				if (!shouldMigratePalette && next[userId]) continue;
				if (next[userId] === color) continue;
				next[userId] = color;
				usedColors.add(color);
				changed = true;
			}
			if (!changed && !shouldMigratePalette) return current;
			saveUserColors(next);
			saveUserColorPaletteVersion(USER_COLOR_PALETTE_VERSION);
			return next;
		});
	}, [state.users]);

	useEffect(() => {
		document.documentElement.dataset["theme"] = settings.theme;
		document.documentElement.style.setProperty("--app-font-size", `${settings.fontSize}px`);
		document.documentElement.style.setProperty(
			"--app-font-family",
			fontFamilyCssValue(settings.fontFamily),
		);
		saveSettings(settings);
	}, [settings]);

	useEffect(() => {
		if (!api) return;
		const userIds = Object.keys(state.users);
		if (userIds.length === 0) return;

		void api.getStatusesByIds(userIds).then((statuses) => {
			setUserStatuses((current) => ({
				...current,
				...Object.fromEntries(statuses.map((status) => [status.user_id, status])),
			}));
		}).catch(() => undefined);

		const missingImageIds = userIds.filter((userId) => !userImages[userId]);
		if (missingImageIds.length === 0) return;
		void Promise.all(
			missingImageIds.map(async (userId) => {
				try {
					return [userId, await api.getFileDataUrl(`/api/v4/users/${encodeURIComponent(userId)}/image`)] as const;
				} catch {
					return null;
				}
			}),
		).then((entries) => {
			const loaded = entries.filter((entry): entry is readonly [string, string] => Boolean(entry));
			if (loaded.length === 0) return;
			setUserImages((current) => ({ ...current, ...Object.fromEntries(loaded) }));
		});
	}, [api, state.users, userImages]);

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
			const nextApi = new MattermostApiClient(normalizedConfig, (request) =>
				electrobun.rpc!.request.mattermostRequest(request),
				(request) => electrobun.rpc!.request.uploadMattermostFiles(request),
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
					const postList = await nextApi.getPostsForChannel(selectedChannel.id);
					posts = postList.posts;
					postOrder = [...postList.order].reverse();
					postUsers = await getPostUsers(
						nextApi,
						Object.values(posts),
						user.id,
					);
					members = await getChannelMembers(nextApi, selectedChannel.id);
					memberUsers = await getUsersForIds(
						nextApi,
						members.map((member) => member.user_id),
						user.id,
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
		[loadPostReactions],
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
						response.body && typeof response.body === "object" && "message" in response.body
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

	useEffect(() => {
		function handleStatus(event: Event) {
			const detail = (
				event as CustomEvent<{ status: WebSocketStatus; message?: string }>
			).detail;
			setWsStatus(detail.status);
			if (detail.status === "error" && detail.message) setError(detail.message);
		}

		function handlePost(event: Event) {
			const post = (event as CustomEvent<{ post: MattermostPost }>).detail.post;
			if (post.channel_id === selectedChannelRef.current) {
				setState((current) =>
					updateChannelLastPostAt(
						addPost(current, post),
						post.channel_id,
						post.create_at,
					),
				);
			} else {
				setState((current) =>
					updateChannelLastPostAt(current, post.channel_id, post.create_at),
				);
			}
			if (api && currentUser) {
				void getPostUsers(api, [post], currentUser.id).then((users) => {
					if (users.length > 0)
						setState((current) => mergeUsers(current, users));
				});
				void loadPostReactions(api, [post]);
			}
			if (post.channel_id !== selectedChannelRef.current) {
				const mention = Boolean(
					currentUser &&
						includesMention(post.message, currentUser.username),
				);
				setChannelNotifications((current) => ({
					...current,
					[post.channel_id]: {
						unread: true,
						mention,
					},
				}));
				const channel = state.channels[post.channel_id];
				if (
					settings.notificationPreference === "all" ||
					(settings.notificationPreference === "mentions" && mention)
				) {
					void electrobun.rpc!.request.showNotification({
						title: channel
							? channelLabel(channel, state.users, currentUser?.id)
							: "Mattermost",
						body: post.message,
						silent: !settings.notificationSounds,
					});
				}
			}
		}

		function handleReaction(event: Event) {
			const detail = (
				event as CustomEvent<{ reaction: MattermostReaction; removed: boolean }>
			).detail;
			setState((current) =>
				applyReaction(current, detail.reaction, detail.removed),
			);
		}

		function handleStatusChange(event: Event) {
			const status = (event as CustomEvent<{ status: MattermostUserStatus }>).detail.status;
			if (!status?.user_id) return;
			setUserStatuses((current) => ({ ...current, [status.user_id]: status }));
		}

		window.addEventListener("mattermost-websocket-status", handleStatus);
		window.addEventListener("mattermost-websocket-post", handlePost);
		window.addEventListener("mattermost-websocket-reaction", handleReaction);
		window.addEventListener("mattermost-websocket-status-change", handleStatusChange);
		return () => {
			window.removeEventListener("mattermost-websocket-status", handleStatus);
			window.removeEventListener("mattermost-websocket-post", handlePost);
			window.removeEventListener(
				"mattermost-websocket-reaction",
				handleReaction,
			);
			window.removeEventListener(
				"mattermost-websocket-status-change",
				handleStatusChange,
			);
		};
	}, [api, currentUser, loadPostReactions, settings.notificationPreference, settings.notificationSounds, state.channels, state.users]);

	useEffect(() => {
		function handleSettingsUpdate(event: Event) {
			const nextSettings = (event as CustomEvent<{ settings: AppSettings }>).detail.settings;
			setSettings(nextSettings);
		}

		function handleMessageMenu(event: Event) {
			const detail = (
				event as CustomEvent<{ action: "copy" | "edit" | "reply"; postId: string }>
			).detail;
			const post = state.posts[detail.postId];
			if (!post) return;
			if (detail.action === "copy") void navigator.clipboard.writeText(post.message);
			if (detail.action === "reply") startReply(post);
			if (detail.action === "edit" && post.user_id === currentUser?.id) setEditTarget(post);
		}

		function handleApplicationMenu(event: Event) {
			const detail = (event as CustomEvent<{ action: "command-menu" | "settings" }>).detail;
			if (detail.action === "command-menu") setCommandOpen(true);
			if (detail.action === "settings") openSettingsWindow(settings);
		}

		function handleKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				setCommandOpen(true);
			}
			if ((event.metaKey || event.ctrlKey) && event.key === ",") {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				openSettingsWindow(settings);
			}
		}

		// Handle link clicks to open in default browser
		function handleLinkClick(event: MouseEvent) {
			const target = event.target as HTMLElement;
			const anchor = target.closest("a");
			
			if (anchor && anchor.href) {
				// Check if it's an external link (http/https/mailto/etc)
				if (anchor.href.match(/^(https?|mailto|tel):/i)) {
					event.preventDefault();
					event.stopPropagation();
					void electrobun.rpc!.request.openExternal({ url: anchor.href });
				}
			}
		}

		window.addEventListener("settings-updated", handleSettingsUpdate);
		window.addEventListener("message-context-menu-action", handleMessageMenu);
		window.addEventListener("application-menu-action", handleApplicationMenu);
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		window.addEventListener("click", handleLinkClick, { capture: true });
		return () => {
			window.removeEventListener("settings-updated", handleSettingsUpdate);
			window.removeEventListener("message-context-menu-action", handleMessageMenu);
			window.removeEventListener("application-menu-action", handleApplicationMenu);
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
			window.removeEventListener("click", handleLinkClick, { capture: true });
		};
	}, [currentUser?.id, settings, state.posts]);

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

	const teams = useMemo(() => Object.values(state.teams), [state.teams]);
	const channels = useMemo(
		() =>
			Object.values(state.channels).filter(
				(channel) =>
					isDirectChannel(channel) || channel.team_id === selectedTeamId,
			),
		[state.channels, selectedTeamId],
	);
	const favoriteChannelSet = useMemo(
		() => new Set(favoriteChannelIds),
		[favoriteChannelIds],
	);
	const archivedChannelSet = useMemo(
		() => new Set(archivedChannelIds),
		[archivedChannelIds],
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
			const postList = firstChannel
				? await api.getPostsForChannel(firstChannel.id)
				: { posts: {}, order: [] };
			const postUsers = await getPostUsers(
				api,
				Object.values(postList.posts),
				currentUser.id,
			);
			const members = firstChannel ? await getChannelMembers(api, firstChannel.id) : [];
			const memberUsers = await getUsersForIds(
				api,
				members.map((member) => member.user_id),
				currentUser.id,
			);
			const nextConfig = {
				...config,
				lastTeamId: team.id,
				lastChannelId: firstChannel?.id,
			};
			saveConfig(nextConfig);
			setConfig(nextConfig);
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
				posts: postList.posts,
				postOrder: [...postList.order].reverse(),
			}));
			setChannelMembers(members);
			setStatus("ready");
			void loadPostReactions(api, Object.values(postList.posts));
		} catch (err) {
			setStatus("error");
			setError(err instanceof Error ? err.message : "Could not load team.");
		}
	}

	async function selectChannel(channel: MattermostChannel) {
		if (!api || !config) return;
		setStatus("loading");
		try {
			const postList = await api.getPostsForChannel(channel.id);
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
			setError(err instanceof Error ? err.message : "Could not load channel.");
		}
	}

	async function selectSearchPost(post: MattermostPost) {
		if (!api || !config) return;
		setStatus("loading");
		try {
			const channel =
				state.channels[post.channel_id] ?? await api.getChannel(post.channel_id);
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
			setError(err instanceof Error ? err.message : "Could not load search result.");
		}
	}

	async function sendMessage(message: string, rootId?: string, files: File[] = []) {
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
					? await api.createPostWithFiles(selectedChannelId, message, fileIds, rootId)
					: await api.createPost(selectedChannelId, message, rootId);
			setState((current) =>
				updateChannelLastPostAt(
					replacePost(current, clientId, created),
					selectedChannelId,
					created.create_at,
				),
			);
		} catch {
			setState((current) => ({
				...current,
				posts: {
					...current.posts,
					[clientId]: { ...pendingPost, pending: false, failed: true },
				},
			}));
		}
		requestAnimationFrame(() => composerRef.current?.focus());
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
		setUserImages({});
		setUserStatuses({});
	}

	function toggleFavoriteChannel(channelId: string) {
		setFavoriteChannelIds((current) => {
			const next = current.includes(channelId)
				? current.filter((favoriteChannelId) => favoriteChannelId !== channelId)
				: [...current, channelId];
			saveFavoriteChannelIds(next);
			return next;
		});
	}

	function archiveChannel(channelId: string) {
		setArchivedChannelIds((current) => {
			if (current.includes(channelId)) return current;
			const next = [...current, channelId];
			saveArchivedChannelIds(next);
			return next;
		});
		setFavoriteChannelIds((current) => {
			if (!current.includes(channelId)) return current;
			const next = current.filter(
				(favoriteChannelId) => favoriteChannelId !== channelId,
			);
			saveFavoriteChannelIds(next);
			return next;
		});
	}

	function unarchiveChannel(channelId: string) {
		setArchivedChannelIds((current) => {
			if (!current.includes(channelId)) return current;
			const next = current.filter(
				(archivedChannelId) => archivedChannelId !== channelId,
			);
			saveArchivedChannelIds(next);
			return next;
		});
	}

	function toggleChannelSection(section: ChannelSectionKey) {
		setCollapsedSections((current) => ({
			...current,
			[section]: !current[section],
		}));
	}

	function setChannelEmoji(channelId: string, emoji: string) {
		setChannelEmojis((current) => {
			const next = { ...current, [channelId]: emoji };
			saveChannelEmojis(next);
			return next;
		});
	}

	function showChannelContextMenu(channel: MattermostChannel) {
		void electrobun.rpc!.request.showChannelContextMenu({
			archived: archivedChannelSet.has(channel.id),
			channelId: channel.id,
			hasEmoji: Boolean(channelEmojis[channel.id]),
			label: channelLabel(channel, state.users, currentUser?.id ?? ""),
		});
	}

	function moveChannel(section: ChannelSectionKey, channelIds: string[]) {
		setChannelOrder((current) => {
			const next = { ...current, [section]: channelIds };
			saveChannelOrder(next);
			return next;
		});
	}

	function resizeSidebar(_: SyntheticEvent, data: ResizeCallbackData) {
		setSidebarWidth(data.size.width);
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

	async function createChannel(displayName: string, name: string, type: "O" | "P") {
		if (!api || !selectedTeamId) return;
		const created = await api.createChannel(selectedTeamId, displayName, name, type);
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
			users: { ...current.users, ...Object.fromEntries(users.map((user) => [user.id, user])) },
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
			users: { ...current.users, ...Object.fromEntries(users.map((user) => [user.id, user])) },
		}));
		setChannelMembers((current) =>
			current.some((item) => item.user_id === member.user_id) ? current : [...current, member],
		);
		setAddUserOpen(false);
	}

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
			/>
		);
	}

	const selectedChannelUsers = channelMembers
		.map((member) => state.users[member.user_id])
		.filter((user): user is MattermostUser => Boolean(user));

	return (
		<Tooltip.Provider>
			<div className="window-shell">
				<Titlebar
					onWindowControl={(action) => {
						void electrobun.rpc!.request.windowControl({ action });
					}}
				/>
				<div
					className="app-shell"
					style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
				>
					<Resizable
						axis="x"
						height={0}
						maxConstraints={[MAX_SIDEBAR_WIDTH, 0]}
						minConstraints={[MIN_SIDEBAR_WIDTH, 0]}
						resizeHandles={["e"]}
						width={sidebarWidth}
						onResize={resizeSidebar}
					>
						<div className="resizable-sidebar" style={{ width: sidebarWidth }}>
							<Sidebar
								channelEmojis={channelEmojis}
								channelOrder={channelOrder}
								collapsedSections={collapsedSections}
								currentUser={currentUser}
								favoriteChannelSet={favoriteChannelSet}
								notifications={channelNotifications}
								sections={sections}
								selectedChannelId={selectedChannelId}
								selectedTeam={selectedTeam}
								selectedTeamId={selectedTeamId}
								teams={teams}
								userImages={userImages}
								userStatuses={userStatuses}
								users={state.users}
								wsStatus={wsStatus}
								onArchiveChannel={archiveChannel}
								onMoveChannel={moveChannel}
								onSelectChannel={selectChannel}
								onSelectTeam={selectTeam}
								onSetChannelEmoji={setChannelEmoji}
								onShowChannelContextMenu={showChannelContextMenu}
								onOpenCreateChannel={() => setCreateChannelOpen(true)}
								onOpenCreateDm={() => setCreateDmOpen(true)}
								onSignOut={signOut}
								onToggleCollapsed={toggleChannelSection}
								onToggleFavorite={toggleFavoriteChannel}
								onUnarchiveChannel={unarchiveChannel}
							/>
						</div>
					</Resizable>

					<main className="main-panel">
						<header className="channel-header">
							<div>
								<p className="eyebrow">Channel</p>
								<h2>
									{selectedChannel
										? channelLabel(selectedChannel, state.users, currentUser.id)
										: "Select a channel"}
								</h2>
								{selectedChannel?.purpose ? (
									<p>{selectedChannel.purpose}</p>
								) : null}
							</div>
							<div className="channel-header-actions">
								<Tooltip.Root>
									<Tooltip.Trigger asChild>
										<div className="member-stack" aria-label="Channel members">
											{selectedChannelUsers.slice(0, 5).map((user) => (
												<span className="member-avatar" key={user.id}>
													{userImages[user.id] ? (
														<img alt="" src={userImages[user.id]} />
													) : (
														initials(user.nickname || user.username)
													)}
													<span className={`status-dot ${userStatuses[user.id]?.status ?? "offline"}`} />
												</span>
											))}
											{channelMembers.length > 5 ? (
												<span className="member-count">+{channelMembers.length - 5}</span>
											) : null}
										</div>
									</Tooltip.Trigger>
									<Tooltip.Portal>
										<Tooltip.Content
											className="tooltip-content channel-members-tooltip"
											side="bottom"
											sideOffset={6}
										>
											<div className="channel-members-list">
												{selectedChannelUsers.map((user) => (
													<div key={user.id} className="channel-member-item">
														<span className={`member-status ${userStatuses[user.id]?.status ?? "offline"}`} />
														<span className="member-name">
															{user.nickname || user.username}
														</span>
													</div>
												))}
											</div>
										</Tooltip.Content>
									</Tooltip.Portal>
								</Tooltip.Root>
								{selectedChannel && isTeamChannel(selectedChannel) ? (
									<button className="secondary-action" type="button" onClick={() => setAddUserOpen(true)}>
										Add user
									</button>
								) : null}
							</div>
						</header>

						{error ? (
							<div className="inline-error">
								<span>{error}</span>
								<button type="button" onClick={() => setError(null)}>
									Dismiss
								</button>
							</div>
						) : null}

						<section className="chat-body">
							<MessageTimeline
								currentUserId={currentUser.id}
								loading={status === "loading"}
								posts={posts}
								resolveImageSrc={resolveImageSrc}
								userColors={userColors}
								userImages={userImages}
								userStatuses={userStatuses}
								users={state.users}
								onShowMessageContextMenu={showMessageContextMenu}
								onReply={startReply}
								onToggleReaction={toggleReaction}
							/>
							<MessageComposer
								currentUserId={currentUser.id}
								disabled={!selectedChannelId || status === "loading"}
								editTarget={editTarget}
								ref={composerRef}
								replyTarget={replyTarget}
								userColors={userColors}
								users={state.users}
								onCancelEdit={() => setEditTarget(null)}
								onCancelReply={() => setReplyTarget(null)}
								onEdit={editMessage}
								onSend={sendMessage}
							/>
						</section>
					</main>
				</div>
				<CommandMenu
					api={api}
					channels={channels}
					currentUserId={currentUser.id}
					open={commandOpen}
					selectedTeamId={selectedTeamId}
					users={state.users}
					onClose={() => setCommandOpen(false)}
					onCreateDm={(userId) => {
						setCommandOpen(false);
						void createDm([userId]);
					}}
					onSelectPost={(post) => {
						setCommandOpen(false);
						void selectSearchPost(post);
					}}
					onSelectChannel={(channel) => {
						setCommandOpen(false);
						void selectChannel(channel);
					}}
					onOpenSettings={() => {
						setCommandOpen(false);
						openSettingsWindow(settings);
					}}
				/>
				<CreateChannelDialog
					open={createChannelOpen}
					onClose={() => setCreateChannelOpen(false)}
					onCreate={(displayName, name, type) => void createChannel(displayName, name, type)}
				/>
				<UserPickerDialog
					api={api}
					open={createDmOpen}
					selectedTeamId={selectedTeamId}
					title="Create direct message"
					onClose={() => setCreateDmOpen(false)}
					onSubmit={(userIds) => void createDm(userIds)}
				/>
				<UserPickerDialog
					api={api}
					open={addUserOpen}
					selectedTeamId={selectedTeamId}
					title="Add user to channel"
					onClose={() => setAddUserOpen(false)}
					onSubmit={(userIds) => {
						const [userId] = userIds;
						if (userId) void addUserToSelectedChannel(userId);
					}}
				/>
			</div>
		</Tooltip.Provider>
	);
}

function CommandMenu({
	api,
	channels,
	currentUserId,
	open,
	selectedTeamId,
	users,
	onClose,
	onCreateDm,
	onOpenSettings,
	onSelectChannel,
	onSelectPost,
}: {
	api: MattermostApiClient | null;
	channels: MattermostChannel[];
	currentUserId: string;
	open: boolean;
	selectedTeamId: string | null;
	users: Record<string, MattermostUser>;
	onClose: () => void;
	onCreateDm: (userId: string) => void;
	onOpenSettings: () => void;
	onSelectChannel: (channel: MattermostChannel) => void;
	onSelectPost: (post: MattermostPost) => void;
}) {
	const [query, setQuery] = useState("");
	const [apiChannels, setApiChannels] = useState<MattermostChannel[]>([]);
	const [apiPosts, setApiPosts] = useState<MattermostPost[]>([]);
	const [apiUsers, setApiUsers] = useState<MattermostUser[]>([]);
	const [searching, setSearching] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const trimmedQuery = query.trim();
	const localResults = channels
		.filter((channel) =>
			channelLabel(channel, users, currentUserId).toLowerCase().includes(trimmedQuery.toLowerCase()),
		)
		.slice(0, 8);
	const localChannelIds = new Set(channels.map((channel) => channel.id));
	const remoteChannels = apiChannels
		.filter((channel) => !localChannelIds.has(channel.id))
		.slice(0, 6);
	const remoteUsers = apiUsers
		.filter((user) => user.id !== currentUserId)
		.slice(0, 6);
	const postResults = apiPosts.slice(0, 8);
	const remoteChannelOffset = localResults.length;
	const postOffset = remoteChannelOffset + remoteChannels.length;
	const userOffset = postOffset + postResults.length;
	const settingsIndex = userOffset + remoteUsers.length;
	const commandItemCount = settingsIndex + 1;

	useEffect(() => {
		if (!open) {
			setQuery("");
			setApiChannels([]);
			setApiPosts([]);
			setApiUsers([]);
			setSearching(false);
			return;
		}
		if (!api || trimmedQuery.length < 2) {
			setApiChannels([]);
			setApiPosts([]);
			setApiUsers([]);
			setSearching(false);
			return;
		}

		let cancelled = false;
		setSearching(true);
		const timer = window.setTimeout(() => {
			void Promise.all([
				selectedTeamId
					? api.searchChannels(selectedTeamId, trimmedQuery).catch(() => [])
					: Promise.resolve([]),
				api.searchPosts(trimmedQuery, selectedTeamId ?? undefined).catch(() => ({
					order: [],
					posts: {} as Record<string, MattermostPost>,
				})),
				api.searchUsers(trimmedQuery, selectedTeamId ?? undefined).catch(() => []),
			]).then(([nextChannels, nextPosts, nextUsers]) => {
				if (cancelled) return;
				setApiChannels(nextChannels);
				setApiPosts(nextPosts.order.map((postId) => nextPosts.posts[postId]).filter(Boolean));
				setApiUsers(nextUsers);
				setSearching(false);
			});
		}, 180);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [api, open, selectedTeamId, trimmedQuery]);

	useEffect(() => {
		setActiveIndex(0);
	}, [query, apiChannels, apiPosts, apiUsers]);

	if (!open) return null;
	function runActiveCommand() {
		if (activeIndex < remoteChannelOffset) {
			onSelectChannel(localResults[activeIndex]);
			return;
		}
		if (activeIndex < postOffset) {
			onSelectChannel(remoteChannels[activeIndex - remoteChannelOffset]);
			return;
		}
		if (activeIndex < userOffset) {
			onSelectPost(postResults[activeIndex - postOffset]);
			return;
		}
		if (activeIndex < settingsIndex) {
			onCreateDm(remoteUsers[activeIndex - userOffset].id);
			return;
		}
		onOpenSettings();
	}
	return (
		<div className="modal-backdrop" onMouseDown={onClose}>
			<div className="command-panel" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
				<input
					autoFocus
					placeholder="Search channels, people, or messages..."
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") onClose();
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setActiveIndex((current) => (current + 1) % commandItemCount);
						}
						if (event.key === "ArrowUp") {
							event.preventDefault();
							setActiveIndex((current) => (current - 1 + commandItemCount) % commandItemCount);
						}
						if (event.key === "Enter") {
							event.preventDefault();
							runActiveCommand();
						}
					}}
				/>
				<div className="command-results">
					{localResults.length > 0 && <p className="command-section-label">Channels</p>}
					{localResults.map((channel, index) => (
						<CommandChannelButton
							active={activeIndex === index}
							channel={channel}
							currentUserId={currentUserId}
							key={channel.id}
							users={users}
							onActive={() => setActiveIndex(index)}
							onSelect={onSelectChannel}
						/>
					))}
					{remoteChannels.length > 0 && <p className="command-section-label">Public channels</p>}
					{remoteChannels.map((channel, index) => (
						<CommandChannelButton
							active={activeIndex === remoteChannelOffset + index}
							channel={channel}
							currentUserId={currentUserId}
							key={channel.id}
							users={users}
							onActive={() => setActiveIndex(remoteChannelOffset + index)}
							onSelect={onSelectChannel}
						/>
					))}
					{postResults.length > 0 && <p className="command-section-label">Messages</p>}
					{postResults.map((post, index) => (
						<button
							className={activeIndex === postOffset + index ? "active" : undefined}
							key={post.id}
							type="button"
							onMouseEnter={() => setActiveIndex(postOffset + index)}
							onClick={() => onSelectPost(post)}
						>
							<span>msg</span>
							<strong>{users[post.user_id]?.username ?? "Unknown user"}</strong>
							<small>{post.message.replace(/\s+/g, " ").slice(0, 96) || "(empty message)"}</small>
						</button>
					))}
					{remoteUsers.length > 0 && <p className="command-section-label">People</p>}
					{remoteUsers.map((user, index) => (
						<button
							className={activeIndex === userOffset + index ? "active" : undefined}
							key={user.id}
							type="button"
							onMouseEnter={() => setActiveIndex(userOffset + index)}
							onClick={() => onCreateDm(user.id)}
						>
							<span>DM</span>
							<strong>{userLabel(user, currentUserId)}</strong>
							<small>@{user.username}</small>
						</button>
					))}
					{trimmedQuery.length >= 2 && searching && (
						<p className="command-empty">Searching Mattermost...</p>
					)}
					{trimmedQuery.length >= 2 && !searching && localResults.length === 0 && remoteChannels.length === 0 && postResults.length === 0 && remoteUsers.length === 0 && (
						<p className="command-empty">No Mattermost results.</p>
					)}
					<button
						className={activeIndex === settingsIndex ? "active" : undefined}
						type="button"
						onMouseEnter={() => setActiveIndex(settingsIndex)}
						onClick={onOpenSettings}
					>
						<span>⌘</span>
						Settings
					</button>
				</div>
			</div>
		</div>
	);
}

function CommandChannelButton({
	active,
	channel,
	currentUserId,
	users,
	onActive,
	onSelect,
}: {
	active: boolean;
	channel: MattermostChannel;
	currentUserId: string;
	users: Record<string, MattermostUser>;
	onActive: () => void;
	onSelect: (channel: MattermostChannel) => void;
}) {
	const label = channelLabel(channel, users, currentUserId);
	return (
		<button
			className={active ? "active" : undefined}
			type="button"
			onMouseEnter={onActive}
			onClick={() => onSelect(channel)}
		>
			<span>{channel.type === "D" ? "DM" : "#"}</span>
			<strong>{label}</strong>
			{channel.type === "O" && channel.display_name && channel.name !== channel.display_name && (
				<small>{channel.name}</small>
			)}
		</button>
	);
}

function CreateChannelDialog({
	open,
	onClose,
	onCreate,
}: {
	open: boolean;
	onClose: () => void;
	onCreate: (displayName: string, name: string, type: "O" | "P") => void;
}) {
	const [displayName, setDisplayName] = useState("");
	const [name, setName] = useState("");
	const [type, setType] = useState<"O" | "P">("O");
	if (!open) return null;
	const channelName = name || slugifyChannelName(displayName);
	return (
		<div className="modal-backdrop" onMouseDown={onClose}>
			<form
				className="settings-panel"
				onMouseDown={(event) => event.stopPropagation()}
				onSubmit={(event) => {
					event.preventDefault();
					if (!displayName.trim() || !channelName) return;
					onCreate(displayName.trim(), channelName, type);
					setDisplayName("");
					setName("");
				}}
			>
				<header>
					<h2>Create channel</h2>
					<button type="button" onClick={onClose}>Cancel</button>
				</header>
				<label>
					<span>Display name</span>
					<input autoFocus required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
				</label>
				<label>
					<span>URL name</span>
					<input placeholder={slugifyChannelName(displayName)} value={name} onChange={(event) => setName(event.target.value)} />
				</label>
				<label>
					<span>Type</span>
					<select value={type} onChange={(event) => setType(event.target.value as "O" | "P")}>
						<option value="O">Public</option>
						<option value="P">Private</option>
					</select>
				</label>
				<button className="primary-action" type="submit">Create</button>
			</form>
		</div>
	);
}

function UserPickerDialog({
	api,
	open,
	selectedTeamId,
	title,
	onClose,
	onSubmit,
}: {
	api: MattermostApiClient | null;
	open: boolean;
	selectedTeamId: string | null;
	title: string;
	onClose: () => void;
	onSubmit: (userIds: string[]) => void;
}) {
	const [query, setQuery] = useState("");
	const [users, setUsers] = useState<MattermostUser[]>([]);
	const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

	useEffect(() => {
		if (!open || !api || query.trim().length < 2) {
			setUsers([]);
			return;
		}
		let cancelled = false;
		void api.searchUsers(query, selectedTeamId ?? undefined)
			.then((nextUsers) => {
				if (!cancelled) setUsers(nextUsers.slice(0, 12));
			})
			.catch(() => {
				if (!cancelled) setUsers([]);
			});
		return () => {
			cancelled = true;
		};
	}, [api, open, query, selectedTeamId]);

	if (!open) return null;
	return (
		<div className="modal-backdrop" onMouseDown={onClose}>
			<div className="settings-panel" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
				<header>
					<h2>{title}</h2>
					<button type="button" onClick={onClose}>Cancel</button>
				</header>
				<input
					autoFocus
					placeholder="Search users..."
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<div className="user-picker-list">
					{users.map((user) => {
						const selected = selectedUserIds.includes(user.id);
						return (
							<button
								className={selected ? "selected" : ""}
								key={user.id}
								type="button"
								onClick={() =>
									setSelectedUserIds((current) =>
										selected ? current.filter((id) => id !== user.id) : [...current, user.id],
									)
								}
							>
								<span>{initials(user.nickname || user.username)}</span>
								{userLabel(user, user.id)}
							</button>
						);
					})}
				</div>
				<button
					className="primary-action"
					disabled={selectedUserIds.length === 0}
					type="button"
					onClick={() => {
						onSubmit(selectedUserIds);
						setQuery("");
						setUsers([]);
						setSelectedUserIds([]);
					}}
				>
					Apply
				</button>
			</div>
		</div>
	);
}

function colorForUserId(userId: string, usedColors = new Set<string>()) {
	let hash = 0;
	for (const character of userId) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	const paletteIndex = hash % USER_COLOR_PALETTE.length;
	for (let offset = 0; offset < USER_COLOR_PALETTE.length; offset += 1) {
		const color =
			USER_COLOR_PALETTE[(paletteIndex + offset) % USER_COLOR_PALETTE.length];
		if (!usedColors.has(color)) return color;
	}
	return USER_COLOR_PALETTE[paletteIndex];
}

async function getPostUsers(
	api: MattermostApiClient,
	posts: MattermostPost[],
	currentUserId?: string,
) {
	const userIds = [
		...new Set(
			posts
				.map((post) => post.user_id)
				.filter((userId) => userId && userId !== currentUserId),
		),
	];
	if (userIds.length === 0) return [];

	try {
		return await api.getUsersByIds(userIds);
	} catch {
		return [];
	}
}

async function getUsersForIds(
	api: MattermostApiClient,
	userIds: string[],
	currentUserId?: string,
) {
	const uniqueUserIds = [
		...new Set(userIds.filter((userId) => userId && userId !== currentUserId)),
	];
	if (uniqueUserIds.length === 0) return [];

	try {
		return await api.getUsersByIds(uniqueUserIds);
	} catch {
		return [];
	}
}

async function getChannelMembers(api: MattermostApiClient, channelId: string) {
	try {
		return await api.getChannelMembers(channelId);
	} catch {
		return [];
	}
}

async function getDirectChannelUsers(
	api: MattermostApiClient,
	channels: MattermostChannel[],
	currentUserId: string,
) {
	const userIds = [
		...new Set(
			channels
				.map((channel) => directChannelOtherUserId(channel, currentUserId))
				.filter((userId): userId is string => Boolean(userId)),
		),
	];
	if (userIds.length === 0) return [];

	try {
		return await api.getUsersByIds(userIds);
	} catch {
		return [];
	}
}

function preferredFirstChannel(channels: MattermostChannel[]) {
	return channels.find(isTeamChannel) ?? channels[0];
}

function slugifyChannelName(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

function fontFamilyCssValue(fontFamily: string) {
	if (fontFamily === "system") {
		return "\"Geist\", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";
	}
	return `"${fontFamily.replace(/"/g, "\\\"")}", ui-sans-serif, system-ui, sans-serif`;
}

function fileToUploadItem(file: File) {
	return new Promise<{
		clientId: string;
		name: string;
		type: string;
		dataUrl: string;
	}>((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			resolve({
				clientId: crypto.randomUUID(),
				name: file.name,
				type: file.type || "application/octet-stream",
				dataUrl: String(reader.result ?? ""),
			});
		});
		reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read file.")));
		reader.readAsDataURL(file);
	});
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing root element.");

createRoot(rootElement).render(<App />);
