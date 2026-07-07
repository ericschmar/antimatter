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

export type MattermostSsoProvider = "openid" | "saml";

export type MattermostSsoLoginRequest = {
	serverUrl: string;
	provider: MattermostSsoProvider;
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

export type MattermostAttachmentOpenRequest = {
	serverUrl: string;
	token: string;
	fileId: string;
	fileName?: string;
	mimeType?: string;
};

export type MattermostAttachmentOpenResponse = {
	success: boolean;
	path?: string;
	message?: string;
};

export type MattermostRpcResponse = {
	status: number;
	ok: boolean;
	body: unknown;
	headers?: Record<string, string>;
};

export type MattermostEnvConfig = {
	giphyApiKey?: string;
	serverUrl?: string;
	token?: string;
};

export type MattermostWebSocketConfig = {
	serverUrl: string;
	token: string;
};

export type MattermostTypingRequest = {
	channelId: string;
	parentId?: string;
};

export type MattermostWebSocketStatus = {
	status: "connecting" | "connected" | "disconnected" | "error";
	message?: string;
};

export type MattermostWebSocketEvent =
	| {
			type: "post";
			post: object;
			teamId?: string;
	  }
	| {
			type: "reaction";
			reaction: object;
			removed: boolean;
	  }
	| {
			type: "statusChange";
			status: unknown;
	  }
	| {
			type: "typing";
			channelId: string;
			parentId?: string;
			userId: string;
	  };

export type MattermostSsoLoginResult = {
	ok: boolean;
	serverUrl: string;
	provider: MattermostSsoProvider;
	token?: string;
	message?: string;
};

export type WindowControlAction = "close" | "minimize" | "maximize";

export type DesktopNotification = {
	title: string;
	body?: string;
	subtitle?: string;
	silent?: boolean;
};

export type AppThemePayload = "default" | "high-contrast" | "warm" | "light";

export type AppSettingsPayload = {
	fontFamily: string;
	fontSize: number;
	theme: AppThemePayload;
	showOwnMessageIndicators: boolean;
	ownMessageIndicatorColor: string;
	notificationSounds: boolean;
	notificationPreference: "all" | "mentions" | "none";
	showProfilePictures: boolean;
	useNewComposer: boolean;
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
	action:
		| "command-menu"
		| "settings"
		| "navigate-favorites"
		| "navigate-channels"
		| "navigate-dms"
		| "navigate-prev-channel"
		| "navigate-next-channel"
		| "navigate-prev-unread"
		| "navigate-next-unread"
		| "navigate-prev-mention"
		| "navigate-next-mention"
		| "attach-file"
		| "attach-image"
		| "open-emoji-picker";
};

export type AppUpdateStatus =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "ready"
	| "applying"
	| "none"
	| "error";

export type AppUpdateState = {
	status: AppUpdateStatus;
	message?: string;
	version?: string;
	hash?: string;
	localVersion?: string;
	localHash?: string;
	updateAvailable: boolean;
	updateReady: boolean;
	error?: string;
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
			startMattermostSsoLogin: {
				params: MattermostSsoLoginRequest;
				response: { success: boolean; loginUrl?: string; message?: string };
			};
			uploadMattermostFiles: {
				params: MattermostFileUploadRequest;
				response: MattermostRpcResponse;
			};
			openMattermostAttachment: {
				params: MattermostAttachmentOpenRequest;
				response: MattermostAttachmentOpenResponse;
			};
			connectMattermostWebSocket: {
				params: MattermostWebSocketConfig;
				response: { success: boolean };
			};
			disconnectMattermostWebSocket: {
				params: {};
				response: { success: boolean };
			};
			sendMattermostTyping: {
				params: MattermostTypingRequest;
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
			getAppUpdateState: {
				params: {};
				response: AppUpdateState;
			};
			checkForAppUpdate: {
				params: {};
				response: AppUpdateState;
			};
			downloadAppUpdate: {
				params: {};
				response: AppUpdateState;
			};
			applyAppUpdate: {
				params: {};
				response: AppUpdateState;
			};
		};
		messages: {
			rendererLog: { line: string };
		};
	};
	webview: {
		requests: {};
		messages: {
			mattermostWebSocketStatus: MattermostWebSocketStatus;
			mattermostWebSocketPost: { post: object; teamId?: string };
			mattermostWebSocketReaction: { reaction: object; removed: boolean };
			mattermostWebSocketStatusChange: { status: unknown };
			mattermostWebSocketTyping: {
				channelId: string;
				parentId?: string;
				userId: string;
			};
			mattermostSsoLoginResult: MattermostSsoLoginResult;
			channelContextMenuAction: ChannelContextMenuAction;
			messageContextMenuAction: MessageContextMenuAction;
			applicationMenuAction: ApplicationMenuAction;
			settingsUpdated: { settings: AppSettingsPayload };
			appUpdateState: AppUpdateState;
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
