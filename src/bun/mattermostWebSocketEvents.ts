import type {
	MattermostWebSocketEvent,
	MattermostWebSocketStatus,
} from "../shared/electrobunRpc";

type MattermostWebSocketMessage = {
	event?: string;
	data?: {
		channel_id?: string;
		parent_id?: string;
		post?: string;
		reaction?: string;
		status?: unknown;
		server_version?: string;
		team_id?: string;
		user_id?: string;
	};
	status?: string;
	error?: string;
	broadcast?: {
		channel_id?: string;
	};
	seq_reply?: number;
};

export function parseMattermostWebSocketMessage(raw: unknown) {
	if (typeof raw !== "string") return null;

	try {
		return JSON.parse(raw) as MattermostWebSocketMessage;
	} catch {
		return null;
	}
}

export function readMattermostWebSocketEvent(
	message: MattermostWebSocketMessage,
): MattermostWebSocketEvent | null {
	const typingChannelId = message.data?.channel_id ?? message.broadcast?.channel_id;
	if (
		(message.event === "user_typing" || message.event === "typing") &&
		typingChannelId &&
		message.data?.user_id
	) {
		return {
			type: "typing",
			channelId: typingChannelId,
			parentId: message.data.parent_id || undefined,
			userId: message.data.user_id,
		};
	}

	if (message.event === "posted" && typeof message.data?.post === "string") {
		const post = parseJsonObject(message.data.post);
		return post
			? { type: "post", post, teamId: message.data.team_id || undefined }
			: null;
	}

	if (
		(message.event === "reaction_added" || message.event === "reaction_removed") &&
		typeof message.data?.reaction === "string"
	) {
		const reaction = parseJsonObject(message.data.reaction);
		return reaction
			? {
					type: "reaction",
					reaction,
					removed: message.event === "reaction_removed",
				}
			: null;
	}

	if (message.event === "status_change" && message.data?.status) {
		return { type: "statusChange", status: readStatusPayload(message.data.status) };
	}

	return null;
}

export function readMattermostWebSocketStatus(
	message: MattermostWebSocketMessage,
	pendingPingSeq: number | null,
): MattermostWebSocketStatus | null {
	if (message.status === "OK" && message.seq_reply) {
		return { status: "connected" };
	}

	if (message.status === "FAIL") {
		return {
			status: "error",
			message: message.error || "Mattermost rejected WebSocket authentication.",
		};
	}

	if (message.event === "hello") {
		return { status: "connected" };
	}

	if (message.seq_reply && message.seq_reply === pendingPingSeq) {
		return { status: "connected" };
	}

	return null;
}

function parseJsonObject(value: string) {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

function readStatusPayload(value: unknown) {
	if (typeof value !== "string") return value;
	const parsed = parseJsonObject(value);
	return parsed ?? value;
}
