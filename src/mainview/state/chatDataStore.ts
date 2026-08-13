import { proxy } from "valtio";
import type { MattermostApiClient } from "../mattermostApi";
import type {
	AppSettings,
	MattermostChannel,
	MattermostUser,
	MattermostUserStatus,
} from "../types";

type Updater<T> = T | ((current: T) => T);

const noopResolveImageSrc = () => Promise.resolve("");

// Pre-sync placeholder. MainViewApp mirrors the real settings (loaded from
// storage by useUserPresence) into the store before the chat workspace renders,
// so this value is never user-visible. Kept local to avoid coupling the store
// to the storage/persistence layer.
const placeholderSettings: AppSettings = {
	fontFamily: "system",
	fontSize: 14,
	theme: "default",
	showOwnMessageIndicators: true,
	ownMessageIndicatorColor: "#46a758",
	notificationSounds: true,
	notificationPreference: "all",
	showProfilePictures: true,
	useNewComposer: false,
	devLoopback: false,
};

export type ChatDataState = {
	api: MattermostApiClient | null;
	currentUserId: string;
	currentUser: MattermostUser | null;
	users: Record<string, MattermostUser>;
	channelsById: Record<string, MattermostChannel>;
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	hasMoreHistoryByChannel: Record<string, boolean>;
	settings: AppSettings;
	resolveImageSrc: (src: string) => Promise<string>;
};

export const initialChatDataState: ChatDataState = {
	api: null,
	currentUserId: "",
	currentUser: null,
	users: {},
	channelsById: {},
	userColors: {},
	userImages: {},
	userStatuses: {},
	hasMoreHistoryByChannel: {},
	settings: { ...placeholderSettings },
	resolveImageSrc: noopResolveImageSrc,
};

export const chatDataStore = proxy<ChatDataState>({ ...initialChatDataState });

export const chatDataActions = {
	resetForSignOut() {
		Object.assign(chatDataStore, {
			...initialChatDataState,
			settings: { ...initialChatDataState.settings },
		});
	},
	setApi(api: MattermostApiClient | null) {
		chatDataStore.api = api;
	},
	setChannelsById(next: Updater<Record<string, MattermostChannel>>) {
		chatDataStore.channelsById = resolveUpdater(
			next,
			chatDataStore.channelsById,
		);
	},
	setChannelHasMoreHistory(channelId: string, hasMore: boolean) {
		chatDataStore.hasMoreHistoryByChannel = {
			...chatDataStore.hasMoreHistoryByChannel,
			[channelId]: hasMore,
		};
	},
	setCurrentUser(user: MattermostUser | null) {
		chatDataStore.currentUser = user;
		chatDataStore.currentUserId = user?.id ?? "";
	},
	setResolveImageSrc(fn: (src: string) => Promise<string>) {
		chatDataStore.resolveImageSrc = fn;
	},
	setSettings(next: Updater<AppSettings>) {
		chatDataStore.settings = resolveUpdater(next, chatDataStore.settings);
	},
	setUserColors(next: Updater<Record<string, string>>) {
		chatDataStore.userColors = resolveUpdater(next, chatDataStore.userColors);
	},
	setUserImages(next: Updater<Record<string, string>>) {
		chatDataStore.userImages = resolveUpdater(next, chatDataStore.userImages);
	},
	setUserStatuses(next: Updater<Record<string, MattermostUserStatus>>) {
		chatDataStore.userStatuses = resolveUpdater(
			next,
			chatDataStore.userStatuses,
		);
	},
	setUsers(next: Updater<Record<string, MattermostUser>>) {
		chatDataStore.users = resolveUpdater(next, chatDataStore.users);
	},
};

function resolveUpdater<T>(next: Updater<T>, current: T) {
	return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}
