import { randomBytes } from "node:crypto";
import { app as electrobunApp, ApplicationMenu, BrowserView, BrowserWindow, ContextMenu, Updater, Utils } from "electrobun/bun";
import { getFonts } from "font-list";
import {
	parseMattermostWebSocketMessage,
	readMattermostWebSocketEvent,
	readMattermostWebSocketStatus,
} from "./mattermostWebSocketEvents";
import {
	getEnvConfig,
	loginWithMattermostDesktopToken,
	mattermostLogin,
	mattermostRequest,
	normalizeServerUrl,
	openMattermostAttachment,
	uploadMattermostFiles,
} from "./mattermostHttp";
import {
	sendMainWebviewMessage,
	sendSettingsWebviewMessage,
} from "./rpcSenders";
import type {
	AppSettingsPayload,
	AppUpdateState,
	AppUpdateStatus,
	ChannelContextMenuAction,
	MessageContextMenuAction,
	MattermostClientRPC,
	MattermostSsoLoginRequest,
	MattermostSsoProvider,
	MattermostTypingRequest,
	MattermostWebSocketConfig,
	SettingsWindowRPC,
} from "../shared/electrobunRpc";

let mattermostSocket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let websocketHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let websocketSeq = 1;
let pendingWebsocketPingSeq: number | null = null;
let websocketClosedByUser = false;
let websocketConfig: MattermostWebSocketConfig | null = null;
let settingsWindow: BrowserWindow | null = null;
let pendingDesktopSsoLogin: {
	clientToken: string;
	provider: MattermostSsoProvider;
	serverUrl: string;
} | null = null;
let latestSettings: AppSettingsPayload = {
	fontFamily: "system",
	fontSize: 14,
	theme: "default",
	notificationSounds: true,
	notificationPreference: "all",
};
let installedFontCache: string[] | null = null;
let appUpdateState: AppUpdateState = {
	status: "idle",
	updateAvailable: false,
	updateReady: false,
};
let updateCheckInFlight: Promise<AppUpdateState> | null = null;
let updateDownloadInFlight: Promise<AppUpdateState> | null = null;

const rpc = BrowserView.defineRPC<MattermostClientRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {
			getEnvConfig: () => getEnvConfig(),
			mattermostRequest: async (request) => mattermostRequest(request),
			mattermostLogin: async (request) => mattermostLogin(request),
			startMattermostSsoLogin: async (request) => startMattermostSsoLogin(request),
			uploadMattermostFiles: async (request) => uploadMattermostFiles(request),
			openMattermostAttachment: async (request) =>
				openMattermostAttachment(request, (path) => Utils.openPath(path)),
			connectMattermostWebSocket: (config) => {
				connectMattermostWebSocket(config);
				return { success: true };
			},
			disconnectMattermostWebSocket: () => {
				disconnectMattermostWebSocket();
				return { success: true };
			},
			sendMattermostTyping: (request) => sendMattermostTyping(request),
			windowControl: ({ action }) => {
				if (action === "close") mainWindow.close();
				if (action === "minimize") mainWindow.minimize();
				if (action === "maximize") {
					if (mainWindow.isMaximized()) mainWindow.unmaximize();
					else mainWindow.maximize();
				}
				return { success: true };
			},
			showNotification: (notification) => {
				Utils.showNotification(notification);
				return { success: true };
			},
			showChannelContextMenu: (request) => {
				showChannelContextMenu(
					request.channelId,
					request.label,
					request.hasEmoji,
					request.archived,
				);
				return { success: true };
			},
			showMessageContextMenu: (request) => {
				showMessageContextMenu(request.postId, request.canEdit);
				return { success: true };
			},
			openSettingsWindow: ({ settings }) => {
				openSettingsWindow(settings);
				return { success: true };
			},
			openExternal: ({ url }) => {
				Utils.openExternal(url);
				return { success: true };
			},
			getAppUpdateState: () => appUpdateState,
			checkForAppUpdate: () => checkForAppUpdate(),
			downloadAppUpdate: () => downloadAppUpdate(),
			applyAppUpdate: () => applyAppUpdate(),
		},
		messages: {},
	},
});

const settingsRpc = BrowserView.defineRPC<SettingsWindowRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {
			getSettings: () => latestSettings,
			getInstalledFonts: async () => getInstalledFonts(),
			updateSettings: ({ settings }) => {
				latestSettings = settings;
				sendMainWebviewMessage(mainWindow, "settingsUpdated", { settings });
				return { success: true };
			},
			settingsWindowControl: ({ action }) => {
				if (!settingsWindow) return { success: false };
				if (action === "close") settingsWindow.close();
				if (action === "minimize") settingsWindow.minimize();
				if (action === "maximize") {
					if (settingsWindow.isMaximized()) settingsWindow.unmaximize();
					else settingsWindow.maximize();
				}
				return { success: true };
			},
			closeSettingsWindow: () => {
				settingsWindow?.close();
				settingsWindow = null;
				return { success: true };
			},
		},
		messages: {},
	},
});

const mainWindow = new BrowserWindow({
	title: "Mattermost Client",
	url: "views://mainview/index.html",
	rpc,
	titleBarStyle: "hidden",
	transparent: true,
	frame: {
		width: 1180,
		height: 760,
		x: 100,
		y: 100,
	},
});

console.log("Mattermost client started.");

setTimeout(() => {
	void checkForAppUpdate({ autoDownload: true, quietNoUpdate: true });
}, 3000);

electrobunApp.on("open-url", (event) => {
	const url = readOpenUrl(event);
	if (!url) return;
	void handleMattermostDesktopLoginUrl(url);
});

ContextMenu.on("context-menu-clicked", (event) => {
	const data = readContextMenuData(event);
	if (!data) return;
	if (data.kind === "channel") {
		sendMainWebviewMessage(mainWindow, "channelContextMenuAction", data.action);
	}
	if (data.kind === "message") {
		sendMainWebviewMessage(mainWindow, "messageContextMenuAction", data.action);
	}
});

ApplicationMenu.on("application-menu-clicked", (event) => {
	const action = readApplicationMenuData(event);
	if (!action) return;
	if (action.action === "check-for-updates") {
		void checkForAppUpdate({ autoDownload: true });
		return;
	}
	if (action.action === "apply-update") {
		void applyAppUpdate();
		return;
	}
	sendMainWebviewMessage(mainWindow, "applicationMenuAction", action);
});

ApplicationMenu.setApplicationMenu([
	{
		label: "Antimatter",
		submenu: [
			{ label: "Settings", action: "settings", accelerator: "CmdOrCtrl+," },
			{ label: "Check for Updates...", action: "check-for-updates" },
			{ label: "Install Update and Restart", action: "apply-update" },
			{ type: "divider" },
			{ role: "quit", accelerator: "CmdOrCtrl+Q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo", accelerator: "CmdOrCtrl+Z" },
			{ role: "redo", accelerator: "Shift+CmdOrCtrl+Z" },
			{ type: "divider" },
			{ role: "cut", accelerator: "CmdOrCtrl+X" },
			{ role: "copy", accelerator: "CmdOrCtrl+C" },
			{ role: "paste", accelerator: "CmdOrCtrl+V" },
		],
	},
	{
		label: "Navigate",
		submenu: [
			{ label: "Command Menu", action: "command-menu", accelerator: "CmdOrCtrl+K" },
		],
	},
]);

function showChannelContextMenu(channelId: string, label: string, hasEmoji: boolean, archived: boolean) {
	ContextMenu.showContextMenu([
		{
			label: hasEmoji ? `Change emoji for ${label}` : `Set emoji for ${label}`,
			action: "set-emoji",
			data: { action: "set-emoji", channelId } satisfies ChannelContextMenuAction,
		},
		{ type: "divider" },
		{
			label: archived ? `Unarchive ${label}` : `Archive ${label}`,
			action: archived ? "unarchive" : "archive",
			data: {
				action: archived ? "unarchive" : "archive",
				channelId,
			} satisfies ChannelContextMenuAction,
		},
	]);
}

function showMessageContextMenu(postId: string, canEdit: boolean) {
	ContextMenu.showContextMenu([
		{
			label: "Copy message",
			action: "copy",
			data: { action: "copy", postId } satisfies MessageContextMenuAction,
		},
		{
			label: "Reply",
			action: "reply",
			data: { action: "reply", postId } satisfies MessageContextMenuAction,
		},
		{
			label: "Edit",
			action: "edit",
			enabled: canEdit,
			data: { action: "edit", postId } satisfies MessageContextMenuAction,
		},
	]);
}

function readContextMenuData(event: unknown):
	| { kind: "channel"; action: ChannelContextMenuAction }
	| { kind: "message"; action: MessageContextMenuAction }
	| null {
	const maybeEvent = event as { data?: { action?: unknown; data?: unknown } };
	const data = maybeEvent.data?.data;
	if (!data || typeof data !== "object") return null;
	const maybeAction = data as Partial<ChannelContextMenuAction>;
	if (
		(maybeAction.action === "set-emoji" ||
			maybeAction.action === "archive" ||
			maybeAction.action === "unarchive") &&
		typeof maybeAction.channelId === "string"
	) {
		return { kind: "channel", action: { action: maybeAction.action, channelId: maybeAction.channelId } };
	}

	const maybeMessageAction = data as Partial<MessageContextMenuAction>;
	if (
		(maybeMessageAction.action === "copy" ||
			maybeMessageAction.action === "edit" ||
			maybeMessageAction.action === "reply") &&
		typeof maybeMessageAction.postId === "string"
	) {
		return {
			kind: "message",
			action: { action: maybeMessageAction.action, postId: maybeMessageAction.postId },
		};
	}
	return null;
}

function readApplicationMenuData(event: unknown) {
	const maybeEvent = event as { data?: { action?: unknown } };
	if (maybeEvent.data?.action === "command-menu") return { action: "command-menu" as const };
	if (maybeEvent.data?.action === "settings") return { action: "settings" as const };
	if (maybeEvent.data?.action === "check-for-updates") return { action: "check-for-updates" as const };
	if (maybeEvent.data?.action === "apply-update") return { action: "apply-update" as const };
	return null;
}

async function checkForAppUpdate(options: { autoDownload?: boolean; quietNoUpdate?: boolean } = {}) {
	if (updateCheckInFlight) return updateCheckInFlight;

	updateCheckInFlight = (async () => {
		setAppUpdateState({ status: "checking", message: "Checking for updates..." });
		try {
			const localInfo = await Updater.getLocalInfo();
			if (!localInfo.baseUrl || !localInfo.channel || localInfo.channel === "dev") {
				setAppUpdateState({
					status: "none",
					localVersion: localInfo.version,
					localHash: localInfo.hash,
					message: "Updates are not configured for this build.",
					updateAvailable: false,
					updateReady: false,
				});
				return appUpdateState;
			}

			const updateInfo = await Updater.checkForUpdate();
			const nextState = normalizeAppUpdateState(updateInfo, localInfo);
			setAppUpdateState(nextState);

			if (nextState.updateAvailable && !nextState.updateReady) {
				if (options.autoDownload) {
					void downloadAppUpdate();
				} else {
					Utils.showNotification({
						title: "Antimatter update available",
						body: nextState.version ? `Version ${nextState.version} is available.` : "A new version is available.",
					});
				}
			} else if (!nextState.updateAvailable && !options.quietNoUpdate) {
				Utils.showNotification({
					title: "Antimatter is up to date",
					body: nextState.localVersion ? `Version ${nextState.localVersion} is installed.` : undefined,
				});
			}

			return appUpdateState;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not check for updates.";
			setAppUpdateState({ status: "error", error: message, message });
			return appUpdateState;
		} finally {
			updateCheckInFlight = null;
		}
	})();

	return updateCheckInFlight;
}

async function downloadAppUpdate() {
	if (updateDownloadInFlight) return updateDownloadInFlight;

	updateDownloadInFlight = (async () => {
		setAppUpdateState({ status: "downloading", message: "Downloading update..." });
		try {
			await Updater.downloadUpdate();
			const updateInfo = Updater.updateInfo();
			const localInfo = await Updater.getLocalInfo();
			setAppUpdateState(normalizeAppUpdateState(updateInfo, localInfo));
			if (appUpdateState.updateReady) {
				Utils.showNotification({
					title: "Antimatter update ready",
					body: "Restart Antimatter to install the update.",
				});
			}
			return appUpdateState;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not download the update.";
			setAppUpdateState({ status: "error", error: message, message });
			return appUpdateState;
		} finally {
			updateDownloadInFlight = null;
		}
	})();

	return updateDownloadInFlight;
}

async function applyAppUpdate() {
	if (!appUpdateState.updateReady) {
		setAppUpdateState({
			status: "none",
			message: "No downloaded update is ready to install.",
			updateAvailable: false,
			updateReady: false,
		});
		return appUpdateState;
	}

	setAppUpdateState({ status: "applying", message: "Installing update..." });
	try {
		await Updater.applyUpdate();
		return appUpdateState;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Could not apply the update.";
		setAppUpdateState({ status: "error", error: message, message });
		return appUpdateState;
	}
}

function setAppUpdateState(next: Partial<AppUpdateState>) {
	const status = resolveAppUpdateStatus(next.status, next);
	appUpdateState = {
		...appUpdateState,
		...next,
		status,
		updateAvailable: next.updateAvailable ?? appUpdateState.updateAvailable,
		updateReady: next.updateReady ?? appUpdateState.updateReady,
	};
	sendMainWebviewMessage(mainWindow, "appUpdateState", appUpdateState);
}

function normalizeAppUpdateState(
	updateInfo: Partial<AppUpdateState> | undefined,
	localInfo: { version?: string; hash?: string } | undefined,
): AppUpdateState {
	const updateAvailable = Boolean(updateInfo?.updateAvailable);
	const updateReady = Boolean(updateInfo?.updateReady);
	const error = updateInfo?.error || undefined;
	return {
		status: resolveAppUpdateStatus(undefined, { updateAvailable, updateReady, error }),
		version: updateInfo?.version,
		hash: updateInfo?.hash,
		localVersion: localInfo?.version,
		localHash: localInfo?.hash,
		updateAvailable,
		updateReady,
		error,
		message: error
			? error
			: updateReady
				? "Update ready to install."
				: updateAvailable
					? "Update available."
					: "No update available.",
	};
}

function resolveAppUpdateStatus(
	status: AppUpdateStatus | undefined,
	state: Partial<AppUpdateState>,
): AppUpdateStatus {
	if (status) return status;
	if (state.error) return "error";
	if (state.updateReady) return "ready";
	if (state.updateAvailable) return "available";
	return "none";
}

function openSettingsWindow(settings: AppSettingsPayload) {
	latestSettings = settings;
	if (settingsWindow && BrowserWindow.getById(settingsWindow.id)) {
		settingsWindow.activate();
		sendSettingsWebviewMessage(settingsWindow, "setSettings", { settings: latestSettings });
		return;
	}
	settingsWindow = null;

	settingsWindow = new BrowserWindow({
		title: "Settings",
		url: "views://childview/index.html",
		rpc: settingsRpc,
		titleBarStyle: "hidden",
		transparent: true,
		frame: {
			width: 420,
			height: 500,
			x: 180,
			y: 140,
		},
	});

	setTimeout(() => {
		if (settingsWindow) {
			sendSettingsWebviewMessage(settingsWindow, "setSettings", { settings: latestSettings });
		}
	}, 100);
}

async function getInstalledFonts() {
	if (installedFontCache) return installedFontCache;
	try {
		const fonts = await getFonts({ disableQuoting: true });
		installedFontCache = normalizeFontNames(fonts);
	} catch {
		installedFontCache = [];
	}
	return installedFontCache;
}

function normalizeFontNames(fonts: string[]) {
	const normalized = new Set<string>();
	for (const font of fonts) {
		const name = font.trim().replace(/^"|"$/g, "");
		if (name && !name.startsWith(".")) normalized.add(name);
	}
	return [...normalized].sort((a, b) => a.localeCompare(b));
}

async function startMattermostSsoLogin(request: MattermostSsoLoginRequest) {
	const serverUrl = normalizeServerUrl(request.serverUrl);
	const clientToken = createDesktopSsoClientToken();
	const loginUrl = getMattermostSsoLoginUrl(
		serverUrl,
		request.provider,
		clientToken,
	);

	pendingDesktopSsoLogin = {
		clientToken,
		provider: request.provider,
		serverUrl,
	};

	console.info(`[sso:${request.provider}] opening external browser ${redactUrl(loginUrl)}`);
	Utils.openExternal(loginUrl);
	return { success: true, loginUrl };
}

function getMattermostSsoLoginUrl(
	serverUrl: string,
	provider: MattermostSsoProvider,
	desktopToken: string,
) {
	const path = provider === "saml" ? "/login/sso/saml" : "/login/sso/openid";
	const url = new URL(path, serverUrl);
	url.searchParams.set("desktop_token", desktopToken);
	return url.toString();
}

function redactUrl(value: string) {
	try {
		const url = new URL(value);
		for (const key of Array.from(url.searchParams.keys())) {
			const currentValue = url.searchParams.get(key) ?? "";
			if (isSensitiveQueryParam(key)) url.searchParams.set(key, "[redacted]");
			else if (/^https?:\/\//i.test(currentValue)) {
				url.searchParams.set(key, redactUrl(currentValue));
			}
		}
		return url.toString();
	} catch {
		return value;
	}
}

function isSensitiveQueryParam(key: string) {
	return [
		"samlrequest",
		"samlresponse",
		"relaystate",
		"code",
		"state",
		"session_state",
		"token",
		"desktop_token",
		"client_token",
		"server_token",
		"requesttoken",
	].includes(key.toLowerCase());
}

function createDesktopSsoClientToken() {
	return `dev-${randomBytes(32).toString("hex")}`.slice(0, 64);
}

function readOpenUrl(event: unknown) {
	if (!event || typeof event !== "object") return null;
	const directUrl = (event as { url?: unknown }).url;
	if (typeof directUrl === "string") return directUrl;
	const data = (event as { data?: unknown }).data;
	if (!data || typeof data !== "object") return null;
	const dataUrl = (data as { url?: unknown }).url;
	return typeof dataUrl === "string" ? dataUrl : null;
}

async function handleMattermostDesktopLoginUrl(value: string) {
	if (!value.startsWith("mattermost-dev://")) return;
	console.info(`[sso] received desktop login deep link ${redactUrl(value)}`);

	const pending = pendingDesktopSsoLogin;
	if (!pending) {
		sendMattermostSsoLoginError("Received a desktop login callback with no pending SSO login.");
		return;
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		sendMattermostSsoLoginError("Received an invalid desktop login callback URL.");
		return;
	}

	const clientToken = url.searchParams.get("client_token");
	const serverToken = url.searchParams.get("server_token");
	if (!serverToken || clientToken !== pending.clientToken) {
		sendMattermostSsoLoginError("Mattermost desktop login callback did not match this SSO attempt.");
		return;
	}

	try {
		const token = await loginWithMattermostDesktopToken(
			pending.serverUrl,
			serverToken,
		);
		pendingDesktopSsoLogin = null;
		sendMainWebviewMessage(mainWindow, "mattermostSsoLoginResult", {
			ok: true,
			serverUrl: pending.serverUrl,
			provider: pending.provider,
			token,
		});
		console.info(`[sso:${pending.provider}] exchanged desktop token successfully`);
	} catch (err) {
		sendMattermostSsoLoginError(
			err instanceof Error
				? err.message
				: "Could not exchange Mattermost desktop login token.",
		);
	}
}

function sendMattermostSsoLoginError(message: string) {
	const pending = pendingDesktopSsoLogin;
	pendingDesktopSsoLogin = null;
	sendMainWebviewMessage(mainWindow, "mattermostSsoLoginResult", {
		ok: false,
		serverUrl: pending?.serverUrl ?? "",
		provider: pending?.provider ?? "saml",
		message,
	});
	console.info(`[sso] ${message}`);
}

function connectMattermostWebSocket(config: MattermostWebSocketConfig) {
	disconnectMattermostWebSocket();
	websocketConfig = config;
	websocketClosedByUser = false;
	openMattermostWebSocket(config);
}

function disconnectMattermostWebSocket() {
	websocketClosedByUser = true;
	if (reconnectTimer) clearTimeout(reconnectTimer);
	reconnectTimer = null;
	stopMattermostWebSocketHeartbeat();
	mattermostSocket?.close();
	mattermostSocket = null;
}

function openMattermostWebSocket(config: MattermostWebSocketConfig) {
	stopMattermostWebSocketHeartbeat();
	sendWebSocketStatus({ status: "connecting" });

	const url = new URL(normalizeServerUrl(config.serverUrl));
	url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
	url.pathname = "/api/v4/websocket";
	url.search = "";

	const socket = new WebSocket(url.toString());
	mattermostSocket = socket;

	socket.addEventListener("open", () => {
		if (mattermostSocket !== socket) return;
		reconnectAttempts = 0;
		socket.send(
			JSON.stringify({
				seq: websocketSeq++,
				action: "authentication_challenge",
				data: { token: config.token },
			}),
		);
		startMattermostWebSocketHeartbeat(socket);
	});

	socket.addEventListener("message", (event) => {
		if (mattermostSocket !== socket) return;
		handleMattermostWebSocketMessage(event.data);
	});

	socket.addEventListener("close", (event) => {
		if (mattermostSocket !== socket) return;
		mattermostSocket = null;
		stopMattermostWebSocketHeartbeat();
		sendWebSocketStatus({
			status: "disconnected",
			message: event.reason || `WebSocket closed with code ${event.code}.`,
		});
		scheduleMattermostReconnect();
	});

	socket.addEventListener("error", () => {
		if (mattermostSocket !== socket) return;
		sendWebSocketStatus({
			status: "error",
			message: "Mattermost WebSocket failed from the Bun process.",
		});
	});
}

function handleMattermostWebSocketMessage(raw: unknown) {
	const message = parseMattermostWebSocketMessage(raw);
	if (!message) return;

	if (message.seq_reply && message.seq_reply === pendingWebsocketPingSeq) {
		pendingWebsocketPingSeq = null;
	}

	const status = readMattermostWebSocketStatus(message, pendingWebsocketPingSeq);
	if (status) {
		sendWebSocketStatus(status);
		if (message.status === "OK" || message.status === "FAIL" || message.event === "hello") return;
	}

	const event = readMattermostWebSocketEvent(message);
	if (!event) return;

	if (event.type === "typing") {
		sendMainWebviewMessage(mainWindow, "mattermostWebSocketTyping", {
			channelId: event.channelId,
			parentId: event.parentId,
			userId: event.userId,
		});
	}
	if (event.type === "post") {
		sendMainWebviewMessage(mainWindow, "mattermostWebSocketPost", {
			post: event.post,
		});
	}
	if (event.type === "reaction") {
		sendMainWebviewMessage(mainWindow, "mattermostWebSocketReaction", {
			reaction: event.reaction,
			removed: event.removed,
		});
	}
	if (event.type === "statusChange") {
		sendMainWebviewMessage(mainWindow, "mattermostWebSocketStatusChange", {
			status: event.status,
		});
	}
}

function sendMattermostTyping(request: MattermostTypingRequest) {
	if (!mattermostSocket || mattermostSocket.readyState !== WebSocket.OPEN) {
		return { success: false };
	}

	mattermostSocket.send(
		JSON.stringify({
			seq: websocketSeq++,
			action: "user_typing",
			data: {
				channel_id: request.channelId,
				parent_id: request.parentId ?? "",
			},
		}),
	);
	return { success: true };
}

function startMattermostWebSocketHeartbeat(socket: WebSocket) {
	stopMattermostWebSocketHeartbeat();
	sendMattermostWebSocketPing(socket);
	websocketHeartbeatTimer = setInterval(() => {
		if (mattermostSocket !== socket) return;

		if (pendingWebsocketPingSeq !== null) {
			reconnectStalledMattermostWebSocket(socket);
			return;
		}

		sendMattermostWebSocketPing(socket);
	}, 30000);
}

function stopMattermostWebSocketHeartbeat() {
	if (websocketHeartbeatTimer) clearInterval(websocketHeartbeatTimer);
	websocketHeartbeatTimer = null;
	pendingWebsocketPingSeq = null;
}

function sendMattermostWebSocketPing(socket: WebSocket) {
	if (socket.readyState !== WebSocket.OPEN) return;
	const seq = websocketSeq++;
	pendingWebsocketPingSeq = seq;
	socket.send(JSON.stringify({ seq, action: "ping" }));
}

function reconnectStalledMattermostWebSocket(socket: WebSocket) {
	if (mattermostSocket !== socket) return;

	mattermostSocket = null;
	stopMattermostWebSocketHeartbeat();
	try {
		socket.close();
	} catch (error) {
		console.error("Failed to close stalled Mattermost WebSocket:", {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	sendWebSocketStatus({
		status: "disconnected",
		message: "Mattermost WebSocket ping timed out.",
	});
	scheduleMattermostReconnect();
}

function scheduleMattermostReconnect() {
	if (websocketClosedByUser || !websocketConfig) return;
	const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts);
	reconnectAttempts += 1;
	reconnectTimer = setTimeout(() => openMattermostWebSocket(websocketConfig!), delay);
}

function sendWebSocketStatus(payload: {
	status: "connecting" | "connected" | "disconnected" | "error";
	message?: string;
}) {
	sendMainWebviewMessage(mainWindow, "mattermostWebSocketStatus", payload);
}
