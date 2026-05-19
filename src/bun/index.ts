import { randomBytes } from "node:crypto";
import { app as electrobunApp, ApplicationMenu, BrowserView, BrowserWindow, ContextMenu, Utils } from "electrobun/bun";
import { getFonts } from "font-list";
import type {
	AppSettingsPayload,
	ChannelContextMenuAction,
	MessageContextMenuAction,
	MattermostFileUploadRequest,
	MattermostLoginRequest,
	MattermostClientRPC,
	MattermostRpcRequest,
	MattermostSsoLoginRequest,
	MattermostSsoProvider,
	MattermostTypingRequest,
	MattermostWebSocketConfig,
	SettingsWindowRPC,
} from "../shared/electrobunRpc";

type MattermostWebSocketMessage = {
	event?: string;
	data?: {
		channel_id?: string;
		parent_id?: string;
		post?: string;
		reaction?: string;
		status?: string;
		server_version?: string;
		user_id?: string;
	};
	status?: string;
	error?: string;
	broadcast?: {
		channel_id?: string;
	};
	seq_reply?: number;
};

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

const rpc = BrowserView.defineRPC<MattermostClientRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {
			getEnvConfig: () => getEnvConfig(),
			mattermostRequest: async (request) => mattermostRequest(request),
			mattermostLogin: async (request) => mattermostLogin(request),
			startMattermostSsoLogin: async (request) => startMattermostSsoLogin(request),
			uploadMattermostFiles: async (request) => uploadMattermostFiles(request),
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
				(mainWindow.webview.rpc as any)?.send?.settingsUpdated({ settings });
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

electrobunApp.on("open-url", (event) => {
	const url = readOpenUrl(event);
	if (!url) return;
	void handleMattermostDesktopLoginUrl(url);
});

ContextMenu.on("context-menu-clicked", (event) => {
	const data = readContextMenuData(event);
	if (!data) return;
	if (data.kind === "channel") {
		(mainWindow.webview.rpc as any)?.send?.channelContextMenuAction(data.action);
	}
	if (data.kind === "message") {
		(mainWindow.webview.rpc as any)?.send?.messageContextMenuAction(data.action);
	}
});

ApplicationMenu.on("application-menu-clicked", (event) => {
	const action = readApplicationMenuData(event);
	if (!action) return;
	(mainWindow.webview.rpc as any)?.send?.applicationMenuAction(action);
});

ApplicationMenu.setApplicationMenu([
	{
		label: "Antimatter",
		submenu: [
			{ label: "Settings", action: "settings", accelerator: "CmdOrCtrl+," },
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
	return null;
}

function openSettingsWindow(settings: AppSettingsPayload) {
	latestSettings = settings;
	if (settingsWindow && BrowserWindow.getById(settingsWindow.id)) {
		settingsWindow.activate();
		(settingsWindow.webview.rpc as any)?.send?.setSettings({ settings: latestSettings });
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
		(settingsWindow?.webview.rpc as any)?.send?.setSettings({ settings: latestSettings });
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

function getEnvConfig() {
	const serverUrl = Bun.env["MATTERMOST_SERVER_URL"]?.trim();
	const token = Bun.env["MATTERMOST_PAT"]?.trim();

	if (!serverUrl || !token) return null;
	return { serverUrl, token };
}

async function mattermostRequest(request: MattermostRpcRequest) {
	const url = new URL(`/api/v4${request.path}`, normalizeServerUrl(request.serverUrl));
	const response = await fetch(url, {
		method: request.method ?? "GET",
		headers: {
			Authorization: `Bearer ${request.token}`,
			...(request.body ? { "Content-Type": "application/json" } : {}),
		},
		body: request.body ? JSON.stringify(request.body) : undefined,
	});
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key] = value;
	});

	return {
		status: response.status,
		ok: response.ok,
		headers,
		body:
			request.responseType === "dataUrl" && response.ok
				? await readDataUrl(response)
				: await readBody(response),
	};
}

async function mattermostLogin(request: MattermostLoginRequest) {
	const url = new URL("/api/v4/users/login", normalizeServerUrl(request.serverUrl));
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			login_id: request.loginId,
			password: request.password,
		}),
	});
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key] = value;
	});
	return {
		status: response.status,
		ok: response.ok,
		headers,
		token: response.headers.get("Token") ?? response.headers.get("token") ?? undefined,
		body: await readBody(response),
	};
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
		(mainWindow.webview.rpc as any)?.send?.mattermostSsoLoginResult({
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

async function loginWithMattermostDesktopToken(
	serverUrl: string,
	serverToken: string,
) {
	const url = new URL("/api/v4/users/login/desktop_token", serverUrl);
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			token: serverToken,
			deviceId: "",
		}),
	});
	const token =
		response.headers.get("Token") ?? response.headers.get("token") ?? undefined;
	if (!response.ok || !token) {
		const body = await readBody(response);
		throw new Error(getMattermostErrorMessage(body, response.status));
	}
	return token;
}

function getMattermostErrorMessage(body: unknown, status: number) {
	return body && typeof body === "object" && "message" in body
		? String((body as { message?: unknown }).message)
		: `Mattermost login failed with ${status}.`;
}

function sendMattermostSsoLoginError(message: string) {
	const pending = pendingDesktopSsoLogin;
	pendingDesktopSsoLogin = null;
	(mainWindow.webview.rpc as any)?.send?.mattermostSsoLoginResult({
		ok: false,
		serverUrl: pending?.serverUrl ?? "",
		provider: pending?.provider ?? "saml",
		message,
	});
	console.info(`[sso] ${message}`);
}

async function uploadMattermostFiles(request: MattermostFileUploadRequest) {
	const url = new URL("/api/v4/files", normalizeServerUrl(request.serverUrl));
	const form = new FormData();
	form.set("channel_id", request.channelId);
	for (const file of request.files) {
		form.append("client_ids", file.clientId);
		form.append("files", dataUrlToBlob(file.dataUrl, file.type), file.name);
	}

	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${request.token}`,
		},
		body: form,
	});
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key] = value;
	});

	return {
		status: response.status,
		ok: response.ok,
		headers,
		body: await readBody(response),
	};
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
	if (typeof raw !== "string") return;

	let message: MattermostWebSocketMessage;
	try {
		message = JSON.parse(raw) as MattermostWebSocketMessage;
	} catch {
		return;
	}

	if (message.seq_reply && message.seq_reply === pendingWebsocketPingSeq) {
		pendingWebsocketPingSeq = null;
	}

	if (message.status === "OK" && message.seq_reply) {
		sendWebSocketStatus({ status: "connected" });
		return;
	}

	if (message.status === "FAIL") {
		sendWebSocketStatus({
			status: "error",
			message: message.error || "Mattermost rejected WebSocket authentication.",
		});
		return;
	}

	if (message.event === "hello") {
		sendWebSocketStatus({ status: "connected" });
		return;
	}

	const typingChannelId = message.data?.channel_id ?? message.broadcast?.channel_id;
	if ((message.event === "user_typing" || message.event === "typing") && typingChannelId && message.data?.user_id) {
		(mainWindow.webview.rpc as any)?.send?.mattermostWebSocketTyping({
			channelId: typingChannelId,
			parentId: message.data.parent_id || undefined,
			userId: message.data.user_id,
		});
	}

	if (message.event === "posted" && message.data?.post) {
		try {
			(mainWindow.webview.rpc as any)?.send?.mattermostWebSocketPost({
				post: JSON.parse(message.data.post) as unknown,
			});
		} catch (error) {
			console.error("Failed to parse post payload:", {
				error: error instanceof Error ? error.message : String(error),
			});
			// Don't send error to UI for individual post failures
		}
	}

	if (
		(message.event === "reaction_added" || message.event === "reaction_removed") &&
		message.data?.reaction
	) {
		try {
			(mainWindow.webview.rpc as any)?.send?.mattermostWebSocketReaction({
				reaction: JSON.parse(message.data.reaction) as unknown,
				removed: message.event === "reaction_removed",
			});
		} catch (error) {
			console.error("Failed to parse reaction payload:", {
				error: error instanceof Error ? error.message : String(error),
			});
			// Don't send error to UI for individual reaction failures
		}
	}

	if (message.event === "status_change" && message.data?.status) {
		try {
			// Handle both JSON-stringified and already-parsed status data
			let status: unknown;
			if (typeof message.data.status === "string") {
				try {
					status = JSON.parse(message.data.status);
				} catch {
					// If JSON.parse fails, maybe it's a simple status string
					// Try to construct a minimal status object
					console.warn("Status data is not valid JSON, treating as raw data:", message.data.status);
					status = message.data.status;
				}
			} else {
				// Already parsed (shouldn't happen based on type definition, but defensive)
				status = message.data.status;
			}
			
			(mainWindow.webview.rpc as any)?.send?.mattermostWebSocketStatusChange({
				status,
			});
		} catch (error) {
			console.error("Failed to process status_change payload:", {
				rawStatus: message.data.status,
				error: error instanceof Error ? error.message : String(error),
			});
			// Don't send error to UI, just log it - status updates are non-critical
		}
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
	(mainWindow.webview.rpc as any)?.send?.mattermostWebSocketStatus(payload);
}

function normalizeServerUrl(value: string) {
	const trimmed = value.trim().replace(/\/+$/, "");
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `https://${trimmed}`;
}

async function readBody(response: Response) {
	const text = await response.text();
	if (!text) return null;

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { message: text };
	}
}

async function readDataUrl(response: Response) {
	const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";
	const bytes = await response.arrayBuffer();
	return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function dataUrlToBlob(dataUrl: string, fallbackType: string) {
	const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
	if (!match) return new Blob([dataUrl], { type: fallbackType || "application/octet-stream" });
	const contentType = match[1] || fallbackType || "application/octet-stream";
	const encoded = match[3] ?? "";
	if (match[2]) {
		return new Blob([Buffer.from(encoded, "base64")], { type: contentType });
	}
	return new Blob([decodeURIComponent(encoded)], { type: contentType });
}
