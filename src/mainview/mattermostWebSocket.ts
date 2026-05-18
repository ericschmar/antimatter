import { normalizeServerUrl } from "./mattermostApi";
import type { MattermostPost, WebSocketClientEvent } from "./types";

type Listener = (event: WebSocketClientEvent) => void;

type MattermostWebSocketMessage = {
	event?: string;
	data?: {
		post?: string;
		server_version?: string;
	};
	status?: string;
	seq_reply?: number;
};

export class MattermostWebSocketClient {
	private readonly serverUrl: string;
	private readonly token: string;
	private readonly listener: Listener;
	private socket: WebSocket | null = null;
	private reconnectTimer: number | null = null;
	private reconnectAttempts = 0;
	private seq = 1;
	private closedByUser = false;

	constructor(serverUrl: string, token: string, listener: Listener) {
		this.serverUrl = normalizeServerUrl(serverUrl);
		this.token = token;
		this.listener = listener;
	}

	connect() {
		this.closedByUser = false;
		this.openSocket();
	}

	close() {
		this.closedByUser = true;
		if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
		this.socket?.close();
		this.socket = null;
	}

	private openSocket() {
		const url = new URL(this.serverUrl);
		url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
		url.pathname = "/api/v4/websocket";
		url.search = "";

		this.socket = new WebSocket(url.toString());

		this.socket.addEventListener("open", () => {
			this.reconnectAttempts = 0;
			this.authenticate();
		});

		this.socket.addEventListener("message", (event) => {
			this.handleMessage(event.data);
		});

		this.socket.addEventListener("close", () => {
			this.listener({ type: "disconnected" });
			this.scheduleReconnect();
		});

		this.socket.addEventListener("error", () => {
			this.listener({ type: "error", message: "WebSocket connection failed." });
		});
	}

	private authenticate() {
		this.socket?.send(
			JSON.stringify({
				seq: this.seq++,
				action: "authentication_challenge",
				data: { token: this.token },
			}),
		);
	}

	private handleMessage(raw: unknown) {
		if (typeof raw !== "string") return;

		let message: MattermostWebSocketMessage;
		try {
			message = JSON.parse(raw) as MattermostWebSocketMessage;
		} catch {
			return;
		}

		if (message.status === "OK" && message.seq_reply) {
			this.listener({ type: "connected" });
			return;
		}

		if (message.event === "hello") {
			this.listener({ type: "connected" });
			return;
		}

		if (message.event === "posted" && message.data?.post) {
			try {
				const post = JSON.parse(message.data.post) as MattermostPost;
				this.listener({ type: "postCreated", post });
			} catch {
				this.listener({ type: "error", message: "Could not parse incoming post." });
			}
		}
	}

	private scheduleReconnect() {
		if (this.closedByUser) return;
		const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempts);
		this.reconnectAttempts += 1;
		this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
	}
}
