export type MattermostRpcRequest = {
	serverUrl: string;
	token: string;
	path: string;
	method?: "GET" | "POST" | "PUT" | "DELETE";
	body?: unknown;
	responseType?: "json" | "dataUrl";
};

export type MattermostLoginRequest = {
	serverUrl: string;
	loginId: string;
	password: string;
};

export type MattermostLoginResponse = {
	status: number;
	ok: boolean;
	token?: string;
	body: unknown;
	headers?: Record<string, string>;
};

export type MattermostFileUploadItem = {
	clientId: string;
	name: string;
	type: string;
	dataUrl: string;
};

export type MattermostFileUploadRequest = {
	serverUrl: string;
	token: string;
	channelId: string;
	files: MattermostFileUploadItem[];
};

export type MattermostRpcResponse = {
	status: number;
	ok: boolean;
	body: unknown;
	headers?: Record<string, string>;
};

export type MattermostEnvConfig = {
	serverUrl: string;
	token: string;
};

export type MattermostWebSocketConfig = {
	serverUrl: string;
	token: string;
};

export type MattermostWebSocketStatus = {
	status: "connecting" | "connected" | "disconnected" | "error";
	message?: string;
};

export type WindowControlAction = "close" | "minimize" | "maximize";

export type DesktopNotification = {
	title: string;
	body?: string;
	subtitle?: string;
	silent?: boolean;
};

export type AppSettingsPayload = {
	fontFamily: string;
	fontSize: number;
	theme: "default" | "high-contrast" | "warm";
	notificationSounds: boolean;
	notificationPreference: "all" | "mentions" | "none";
};

export type ChannelContextMenuRequest = {
	channelId: string;
	label: string;
	hasEmoji: boolean;
	archived: boolean;
};

export type ChannelContextMenuAction = {
	action: "archive" | "set-emoji" | "unarchive";
	channelId: string;
};

export type MessageContextMenuRequest = {
	postId: string;
	canEdit: boolean;
};

export type MessageContextMenuAction = {
	action: "copy" | "edit" | "reply";
	postId: string;
};

export type ApplicationMenuAction = {
	action: "command-menu" | "settings";
};

export type MattermostClientRPC = {
	bun: {
		requests: {
			getEnvConfig: {
				params: {};
				response: MattermostEnvConfig | null;
			};
			mattermostRequest: {
				params: MattermostRpcRequest;
				response: MattermostRpcResponse;
			};
			mattermostLogin: {
				params: MattermostLoginRequest;
				response: MattermostLoginResponse;
			};
			uploadMattermostFiles: {
				params: MattermostFileUploadRequest;
				response: MattermostRpcResponse;
			};
			connectMattermostWebSocket: {
				params: MattermostWebSocketConfig;
				response: { success: boolean };
			};
			disconnectMattermostWebSocket: {
				params: {};
				response: { success: boolean };
			};
			windowControl: {
				params: { action: WindowControlAction };
				response: { success: boolean };
			};
			showNotification: {
				params: DesktopNotification;
				response: { success: boolean };
			};
			showChannelContextMenu: {
				params: ChannelContextMenuRequest;
				response: { success: boolean };
			};
			showMessageContextMenu: {
				params: MessageContextMenuRequest;
				response: { success: boolean };
			};
			openSettingsWindow: {
				params: { settings: AppSettingsPayload };
				response: { success: boolean };
			};
			openExternal: {
				params: { url: string };
				response: { success: boolean };
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			mattermostWebSocketStatus: MattermostWebSocketStatus;
			mattermostWebSocketPost: { post: unknown };
			mattermostWebSocketReaction: { reaction: unknown; removed: boolean };
			mattermostWebSocketStatusChange: { status: unknown };
			channelContextMenuAction: ChannelContextMenuAction;
			messageContextMenuAction: MessageContextMenuAction;
			applicationMenuAction: ApplicationMenuAction;
			settingsUpdated: { settings: AppSettingsPayload };
		};
	};
};

export type SettingsWindowRPC = {
	bun: {
		requests: {
			getSettings: {
				params: {};
				response: AppSettingsPayload;
			};
			getInstalledFonts: {
				params: {};
				response: string[];
			};
			updateSettings: {
				params: { settings: AppSettingsPayload };
				response: { success: boolean };
			};
			settingsWindowControl: {
				params: { action: WindowControlAction };
				response: { success: boolean };
			};
			closeSettingsWindow: {
				params: {};
				response: { success: boolean };
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			setSettings: { settings: AppSettingsPayload };
		};
	};
};
