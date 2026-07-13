import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
	ApplicationMenuAction,
	AppUpdateState,
	MattermostSsoLoginResult,
} from "../../../shared/electrobunRpc";
import { MattermostApiClient } from "../../mattermostApi";
import type {
	AppSettings,
	ChannelHistoryData,
	ChannelNotificationState,
	MattermostConfig,
	MattermostPost,
	MattermostReaction,
	MattermostUser,
	MattermostUserStatus,
	NormalizedState,
	TeamUnreadState,
	TypingUsersByChannel,
	WebSocketStatus,
} from "../../types";
import type { AppStatus } from "../../state/uiStore";
import { channelLabel, includesMention, userLabel } from "../../utils/format";
import { getDirectChannelUsers, getPostUsers } from "../../utils/mattermostLoaders";
import {
	addPost,
	applyReaction,
	mergeUsers,
	updateChannelLastPostAt,
	updatePost,
} from "../../utils/state";
import { electrobun, rendererLog } from "../../app/rpc";

export function useMainViewEvents({
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
	setAppUpdate,
	setTeamUnread,
	setUserStatuses,
	setTypingUsers,
	setWsStatus,
}: UseMainViewEventsArgs) {
	useEffect(() => {
		function handleStatus(event: Event) {
			const detail = (
				event as CustomEvent<{ status: WebSocketStatus; message?: string }>
			).detail;
			setWsStatus(detail.status);
			if (detail.status === "error" && detail.message) setError(detail.message);
		}

		function handleAppUpdateState(event: Event) {
			setAppUpdate((event as CustomEvent<AppUpdateState>).detail);
		}

		function handleSsoResult(event: Event) {
			const detail = (event as CustomEvent<MattermostSsoLoginResult>).detail;
			if (!detail.ok || !detail.token) {
				setStatus("error");
				setError(detail.message ?? "SSO login did not return a session token.");
				return;
			}

			void connect({
				serverUrl: detail.serverUrl,
				token: detail.token,
				authMethod: "sso",
			});
		}

		function handlePost(event: Event) {
			const detail = (
				event as CustomEvent<{ post: MattermostPost; teamId?: string }>
			).detail;
			const post = detail.post;
			const { teamId } = detail;
			const postUsersPromise =
				api && currentUser ? getPostUsers(api, [post], currentUser.id) : null;
			setTypingUsers((current) => removeTypingUser(current, post.channel_id, post.user_id));
			if (api && currentUser && !state.channels[post.channel_id]) {
				void api.getChannel(post.channel_id).then(async (channel) => {
					const channelUsers = await getDirectChannelUsers(
						api,
						[channel],
						currentUser.id,
					);
					setState((current) =>
						updateChannelLastPostAt(
							{
								...current,
								channels: {
									...current.channels,
									[channel.id]: channel,
								},
								users: {
									...current.users,
									...Object.fromEntries(
										channelUsers.map((user) => [user.id, user]),
									),
								},
							},
							post.channel_id,
							post.create_at,
						),
					);
				}).catch(() => undefined);
			}
			if (post.channel_id === selectedChannelRef.current) {
				mutateSelectedChannelHistory((current) =>
					addPostToHistory(current, post),
				);
				setState((current) =>
					updateChannelLastPostAt(
						current.posts[post.id] ? updatePost(current, post) : addPost(current, post),
						post.channel_id,
						post.create_at,
					),
				);
			} else {
				setState((current) =>
					updateChannelLastPostAt(current, post.channel_id, post.create_at),
				);
			}
			if (api && postUsersPromise) {
				void postUsersPromise.then((users) => {
					if (users.length > 0)
						setState((current) => mergeUsers(current, users));
				});
				void loadPostReactions(api, [post]);
			}
			rendererLog("Notification", "Channel check:", {
				postId: post.id,
				postChannelId: post.channel_id,
				selectedChannelId: selectedChannelRef.current,
				isSelectedChannel: post.channel_id === selectedChannelRef.current,
			});
			if (post.channel_id !== selectedChannelRef.current) {
				const mention = Boolean(
					currentUser &&
						includesMention(post.message, currentUser.username),
				);
				setChannelNotifications((current) => ({
					...current,
					[post.channel_id]: {
						unread: true,
						mention: current[post.channel_id]?.mention || mention,
					},
				}));
				if (teamId) {
					setTeamUnread((current) =>
						current[teamId] ? current : { ...current, [teamId]: true },
					);
				}
				const channel = state.channels[post.channel_id];
				rendererLog("Notification", "Settings check:", {
					postId: post.id,
					notificationPreference: settings.notificationPreference,
					hasMention: mention,
					willNotify:
						settings.notificationPreference === "all" ||
						(settings.notificationPreference === "mentions" && mention),
				});
				if (
					settings.notificationPreference === "all" ||
					(settings.notificationPreference === "mentions" && mention)
				) {
					const showNotification = (users: MattermostUser[] = []) => {
						const notificationUsers =
							users.length > 0
								? {
										...state.users,
										...Object.fromEntries(users.map((user) => [user.id, user])),
									}
								: state.users;
						const sender = userLabel(
							notificationUsers[post.user_id],
							post.user_id,
						);
						const channelName = channel
							? channelLabel(channel, notificationUsers, currentUser?.id)
							: "Mattermost";
						// Handoff back to bun: renderer asks bun to fire the OS notification.
						// Correlate vs "[Notification] Fired by bun" to separate renderer
						// decision delay from bun fire delay (antimatter-vkb).
						rendererLog("Notification", "Requesting from renderer:", {
							postId: post.id,
							hasFocus: document.hasFocus(),
						});
						void electrobun.rpc!.request.showNotification({
							title: `${sender} in ${channelName}`,
							body: post.message,
							silent: !settings.notificationSounds,
						});
					};
					if (state.users[post.user_id] || !postUsersPromise) {
						rendererLog("Notification", "Showing immediately:", {
							postId: post.id,
							userCached: !!state.users[post.user_id],
						});
						showNotification();
					} else {
						rendererLog("Notification", "Waiting for user data:", {
							postId: post.id,
							userId: post.user_id,
						});
						void postUsersPromise.then((users) => {
							rendererLog("Notification", "User data loaded, showing:", {
								postId: post.id,
								usersLoaded: users.length,
							});
							showNotification(users);
						}).catch(() => {
							rendererLog("Notification", "User data failed, showing anyway:", {
								postId: post.id,
							});
							showNotification();
						});
					}
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

		function handleTyping(event: Event) {
			const detail = (
				event as CustomEvent<{
					channelId: string;
					parentId?: string;
					userId: string;
				}>
			).detail;
			if (!detail.channelId || !detail.userId || detail.userId === currentUser?.id)
				return;

			setTypingUsers((current) => ({
				...current,
				[detail.channelId]: {
					...(current[detail.channelId] ?? {}),
					[detail.userId]: {
						expiresAt: Date.now() + 6000,
						parentId: detail.parentId,
					},
				},
			}));
		}

		window.addEventListener("mattermost-websocket-status", handleStatus);
		window.addEventListener("app-update-state", handleAppUpdateState);
		window.addEventListener("mattermost-sso-login-result", handleSsoResult);
		window.addEventListener("mattermost-websocket-post", handlePost);
		window.addEventListener("mattermost-websocket-reaction", handleReaction);
		window.addEventListener("mattermost-websocket-status-change", handleStatusChange);
		window.addEventListener("mattermost-websocket-typing", handleTyping);
		return () => {
			window.removeEventListener("mattermost-websocket-status", handleStatus);
			window.removeEventListener("app-update-state", handleAppUpdateState);
			window.removeEventListener("mattermost-sso-login-result", handleSsoResult);
			window.removeEventListener("mattermost-websocket-post", handlePost);
			window.removeEventListener(
				"mattermost-websocket-reaction",
				handleReaction,
			);
			window.removeEventListener(
				"mattermost-websocket-status-change",
				handleStatusChange,
			);
			window.removeEventListener("mattermost-websocket-typing", handleTyping);
		};
	}, [api, connect, currentUser, loadPostReactions, mutateSelectedChannelHistory, selectedChannelRef, settings.notificationPreference, settings.notificationSounds, state, setAppUpdate, setChannelNotifications, setError, setState, setStatus, setTeamUnread, setTypingUsers, setUserStatuses, setWsStatus]);

	useEffect(() => {
		function handleSettingsUpdate(event: Event) {
			const nextSettings = (event as CustomEvent<{ settings: AppSettings }>).detail.settings;
			setSettings(nextSettings);
		}

		function handleMessageMenu(event: Event) {
			const detail = (
				event as CustomEvent<{ action: "copy" | "delete" | "edit" | "reply"; postId: string }>
			).detail;
			const post = state.posts[detail.postId];
			if (!post) return;
			if (detail.action === "copy") void navigator.clipboard.writeText(post.message);
			if (detail.action === "reply") startReply(post);
			if (detail.action === "edit" && post.user_id === currentUser?.id) setEditTarget(post);
			if (
				detail.action === "delete" &&
				api &&
				post.user_id === currentUser?.id &&
				!post.pending &&
				post.delete_at === 0
			) {
				const previousPost = post;
				const deletedAt = Date.now();
				const deletedPost = { ...post, delete_at: deletedAt, update_at: deletedAt };
				setState((current) => updatePost(current, deletedPost));
				void api.deletePost(post.id).catch((err) => {
					setState((current) => updatePost(current, previousPost));
					setError(err instanceof Error ? err.message : "Could not delete message.");
				});
			}
		}

		function handleApplicationMenu(event: Event) {
			const detail = (event as CustomEvent<ApplicationMenuAction>).detail;
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

		function handleLinkClick(event: MouseEvent) {
			const target = event.target as HTMLElement;
			const anchor = target.closest("a");

			if (anchor && anchor.href) {
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
	}, [api, currentUser?.id, openSettingsWindow, settings, setCommandOpen, setEditTarget, setError, setSettings, setState, startReply, state.posts]);
}

type UseMainViewEventsArgs = {
	api: MattermostApiClient | null;
	connect: (config: MattermostConfig) => Promise<void>;
	currentUser: MattermostUser | null;
	loadPostReactions: (api: MattermostApiClient, posts: MattermostPost[]) => Promise<void>;
	mutateSelectedChannelHistory: (
		updater: (
			current: ChannelHistoryData | undefined,
		) => ChannelHistoryData | undefined,
	) => void;
	openSettingsWindow: (settings: AppSettings) => void;
	selectedChannelRef: MutableRefObject<string | null>;
	settings: AppSettings;
	startReply: (post: MattermostPost) => void;
	state: NormalizedState;
	setChannelNotifications: Dispatch<SetStateAction<ChannelNotificationState>>;
	setCommandOpen: (open: boolean) => void;
	setEditTarget: (post: MattermostPost | null) => void;
	setError: (error: string | null) => void;
	setSettings: Dispatch<SetStateAction<AppSettings>>;
	setStatus: (status: AppStatus) => void;
	setState: Dispatch<SetStateAction<NormalizedState>>;
	setAppUpdate: Dispatch<SetStateAction<AppUpdateState>>;
	setTeamUnread: Dispatch<SetStateAction<TeamUnreadState>>;
	setTypingUsers: Dispatch<SetStateAction<TypingUsersByChannel>>;
	setUserStatuses: Dispatch<SetStateAction<Record<string, MattermostUserStatus>>>;
	setWsStatus: (status: WebSocketStatus) => void;
};

function addPostToHistory(
	history: ChannelHistoryData | undefined,
	post: MattermostPost,
): ChannelHistoryData | undefined {
	if (!history) return history;
	if (history.posts[post.id]) {
		return {
			...history,
			posts: { ...history.posts, [post.id]: post },
		};
	}
	return {
		...history,
		posts: { ...history.posts, [post.id]: post },
		postOrder: [...history.postOrder, post.id],
	};
}

function removeTypingUser(
	current: TypingUsersByChannel,
	channelId: string,
	userId: string,
) {
	const channelTyping = current[channelId];
	if (!channelTyping?.[userId]) return current;

	const nextChannelTyping = { ...channelTyping };
	delete nextChannelTyping[userId];

	if (Object.keys(nextChannelTyping).length === 0) {
		const next = { ...current };
		delete next[channelId];
		return next;
	}

	return { ...current, [channelId]: nextChannelTyping };
}
