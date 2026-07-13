import { proxy } from "valtio";
import type {
	ChannelNotificationState,
	MattermostPost,
	TeamUnreadState,
	TypingUsersByChannel,
	WebSocketStatus,
} from "../types";

export type AppStatus = "idle" | "loading" | "ready" | "error";

type Updater<T> = T | ((current: T) => T);

export type MainViewUiState = {
	addUserOpen: boolean;
	channelNotifications: ChannelNotificationState;
	commandOpen: boolean;
	createChannelOpen: boolean;
	createDmOpen: boolean;
	editTarget: MattermostPost | null;
	error: string | null;
	loadingHistory: boolean;
	replyTarget: MattermostPost | null;
	status: AppStatus;
	teamUnread: TeamUnreadState;
	typingUsers: TypingUsersByChannel;
	wsStatus: WebSocketStatus;
};

export const initialMainViewUiState: MainViewUiState = {
	addUserOpen: false,
	channelNotifications: {},
	commandOpen: false,
	createChannelOpen: false,
	createDmOpen: false,
	editTarget: null,
	error: null,
	loadingHistory: false,
	replyTarget: null,
	status: "idle",
	teamUnread: {},
	typingUsers: {},
	wsStatus: "idle",
};

export const uiStore = proxy<MainViewUiState>({ ...initialMainViewUiState });

export const uiActions = {
	clearChannelNotification(channelId: string) {
		const next = { ...uiStore.channelNotifications };
		delete next[channelId];
		uiStore.channelNotifications = next;
	},
	resetForChannelChange() {
		uiStore.editTarget = null;
		uiStore.replyTarget = null;
		uiStore.loadingHistory = false;
	},
	resetForSignOut() {
		Object.assign(uiStore, initialMainViewUiState);
	},
	setAddUserOpen(open: boolean) {
		uiStore.addUserOpen = open;
	},
	setChannelNotifications(next: Updater<ChannelNotificationState>) {
		uiStore.channelNotifications = resolveUpdater(
			next,
			uiStore.channelNotifications,
		);
	},
	setCommandOpen(open: boolean) {
		uiStore.commandOpen = open;
	},
	setCreateChannelOpen(open: boolean) {
		uiStore.createChannelOpen = open;
	},
	setCreateDmOpen(open: boolean) {
		uiStore.createDmOpen = open;
	},
	setEditTarget(post: MattermostPost | null) {
		uiStore.editTarget = post;
	},
	setError(error: string | null) {
		uiStore.error = error;
	},
	setLoadingHistory(loading: boolean) {
		uiStore.loadingHistory = loading;
	},
	setReplyTarget(post: MattermostPost | null) {
		uiStore.replyTarget = post;
	},
	setStatus(status: AppStatus) {
		uiStore.status = status;
	},
	setTeamUnread(next: Updater<TeamUnreadState>) {
		uiStore.teamUnread = resolveUpdater(next, uiStore.teamUnread);
	},
	setTypingUsers(next: Updater<TypingUsersByChannel>) {
		uiStore.typingUsers = resolveUpdater(next, uiStore.typingUsers);
	},
	setWsStatus(status: WebSocketStatus) {
		uiStore.wsStatus = status;
	},
};

function resolveUpdater<T>(next: Updater<T>, current: T) {
	return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}
