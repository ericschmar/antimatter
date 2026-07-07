export type MattermostConfig = {
	serverUrl: string;
	token: string;
	authMethod?: "pat" | "password" | "sso";
	lastTeamId?: string;
	lastChannelId?: string;
};

export type MattermostUser = {
	id: string;
	username: string;
	first_name?: string;
	last_name?: string;
	nickname?: string;
	email?: string;
	position?: string;
};

export type MattermostUserStatus = {
	user_id: string;
	status: "online" | "away" | "dnd" | "offline" | string;
	manual?: boolean;
	last_activity_at?: number;
};

export type MattermostChannelMember = {
	channel_id: string;
	user_id: string;
	roles?: string;
	last_viewed_at?: number;
	msg_count?: number;
	mention_count?: number;
};

export type MattermostTeam = {
	id: string;
	name: string;
	display_name: string;
	description?: string;
};

export type MattermostChannel = {
	id: string;
	team_id: string;
	name: string;
	display_name: string;
	type: "O" | "P" | "D" | "G";
	create_at?: number;
	update_at?: number;
	last_post_at?: number;
	header?: string;
	purpose?: string;
};

export type MattermostPost = {
	id: string;
	create_at: number;
	update_at: number;
	delete_at: number;
	user_id: string;
	channel_id: string;
	root_id?: string;
	message: string;
	props?: Record<string, unknown>;
	metadata?: {
		reactions?: MattermostReaction[];
		files?: MattermostFileInfo[];
	};
	pending?: boolean;
	failed?: boolean;
	client_id?: string;
};

export type MattermostFileInfo = {
	id: string;
	name?: string;
	mime_type?: string;
	has_preview_image?: boolean;
	extension?: string;
};

export type MattermostUploadedFile = {
	id: string;
	name?: string;
	extension?: string;
	size?: number;
	mime_type?: string;
};

export type MattermostFileUploadResponse = {
	file_infos: MattermostUploadedFile[];
	client_ids?: string[];
};

export type MattermostReaction = {
	user_id: string;
	post_id: string;
	emoji_name: string;
	create_at?: number;
};

export type PostListResponse = {
	order: string[];
	posts: Record<string, MattermostPost>;
	next_post_id?: string;
	prev_post_id?: string;
};

export type PostSearchResponse = PostListResponse & {
	matches?: Record<string, string[]>;
};

export type NormalizedState = {
	users: Record<string, MattermostUser>;
	teams: Record<string, MattermostTeam>;
	channels: Record<string, MattermostChannel>;
	posts: Record<string, MattermostPost>;
	postOrder: string[];
};

export type ChannelHistoryData = {
	memberUsers: MattermostUser[];
	members: MattermostChannelMember[];
	postOrder: string[];
	posts: Record<string, MattermostPost>;
	postUsers: MattermostUser[];
};

export type ChannelSectionKey = "favorites" | "channels" | "dms" | "archived";

export type ChannelNotificationState = Record<
	string,
	{
		unread: boolean;
		mention: boolean;
	}
>;

export type TeamUnreadState = Record<string, boolean>;

export type TypingUsersByChannel = Record<
	string,
	Record<
		string,
		{
			expiresAt: number;
			parentId?: string;
		}
	>
>;

export type NotificationPreference = "all" | "mentions" | "none";

export type AppTheme = "default" | "high-contrast" | "warm" | "light";

export type AppSettings = {
	fontFamily: string;
	fontSize: number;
	theme: AppTheme;
	showOwnMessageIndicators: boolean;
	ownMessageIndicatorColor: string;
	notificationSounds: boolean;
	notificationPreference: NotificationPreference;
	showProfilePictures: boolean;
	useNewComposer: boolean;
};

export type WebSocketStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export type WebSocketClientEvent =
	| { type: "connected" }
	| { type: "disconnected"; reason?: string }
	| { type: "postCreated"; post: MattermostPost }
	| { type: "error"; message: string };
