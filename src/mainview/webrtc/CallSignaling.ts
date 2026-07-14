import type { MattermostApiClient } from "../mattermostApi";
import type { MattermostPost } from "../types";
import type { CallPost, CallType, SignalingMessage } from "./types";

const SIGNALING_POST_TYPE = "custom_webrtc_call";
const ICE_BATCH_DELAY_MS = 100;
const OFFER_ANSWER_MAX_AGE_MS = 60_000;

type SignalingPostInput = {
	channelId: string;
	message: string;
	type: typeof SIGNALING_POST_TYPE;
	props: SignalingMessage & { from_webhook?: "true" };
};

type SignalingApi = Pick<MattermostApiClient, "createDirectChannel"> & {
	createCustomPost(post: SignalingPostInput): Promise<MattermostPost>;
};

export class CallSignaling {
	private iceCandidateBuffer = new Map<string, RTCIceCandidateInit[]>();
	private batchTimeout = new Map<string, number>();

	constructor(
		private mattermostApi: SignalingApi,
		private currentUserId: string,
		private onMessage: (message: SignalingMessage, channelId: string) => void,
	) {}

	async send(message: SignalingMessage, channelId: string): Promise<void> {
		const messageWithSender = {
			...message,
			senderId: this.currentUserId,
		};

		if (messageWithSender.action === "ice-candidate" && messageWithSender.candidate) {
			this.batchIceCandidate(messageWithSender, channelId);
			return;
		}

		await this.createSignalingPost(messageWithSender, channelId);
	}

	handlePost(post: MattermostPost, expectedUserId?: string): boolean {
		if (post.type !== SIGNALING_POST_TYPE) return false;

		const message = post.props;
		if (!isValidSignalingMessage(message)) return false;
		if (expectedUserId && message.senderId !== expectedUserId) return false;

		if (message.action === "offer" || message.action === "answer") {
			if (Date.now() - message.timestamp > OFFER_ANSWER_MAX_AGE_MS) return false;
		}

		this.onMessage(message, post.channel_id);
		return true;
	}

	cleanup(sessionId: string): void {
		for (const [key, timeout] of this.batchTimeout.entries()) {
			if (key.startsWith(`${sessionId}-`)) {
				window.clearTimeout(timeout);
				this.batchTimeout.delete(key);
				this.iceCandidateBuffer.delete(key);
			}
		}
	}

	async getDmChannelId(userId: string, myUserId = this.currentUserId): Promise<string> {
		const channel = await this.mattermostApi.createDirectChannel([myUserId, userId]);
		return channel.id;
	}

	private batchIceCandidate(message: SignalingMessage, channelId: string): void {
		const key = `${message.sessionId}-${channelId}`;
		const candidates = this.iceCandidateBuffer.get(key) ?? [];
		if (message.candidate) candidates.push(message.candidate);
		this.iceCandidateBuffer.set(key, candidates);

		const existingTimeout = this.batchTimeout.get(key);
		if (existingTimeout) window.clearTimeout(existingTimeout);

		const timeout = window.setTimeout(() => {
			void this.flushIceCandidates(message.sessionId, channelId);
		}, ICE_BATCH_DELAY_MS);
		this.batchTimeout.set(key, timeout);
	}

	private async flushIceCandidates(
		sessionId: string,
		channelId: string,
	): Promise<void> {
		const key = `${sessionId}-${channelId}`;
		const candidates = this.iceCandidateBuffer.get(key);
		if (!candidates?.length) return;

		this.iceCandidateBuffer.delete(key);
		const timeout = this.batchTimeout.get(key);
		if (timeout) window.clearTimeout(timeout);
		this.batchTimeout.delete(key);

		await this.createSignalingPost(
			{
				action: "ice-candidate",
				sessionId,
				timestamp: Date.now(),
				senderId: this.currentUserId,
				candidates,
			},
			channelId,
		);
	}

	private createSignalingPost(message: SignalingMessage, channelId: string) {
		return this.mattermostApi.createCustomPost({
			channelId,
			message: getHumanReadableMessage(message),
			type: SIGNALING_POST_TYPE,
			props: {
				...message,
				from_webhook: "true",
			},
		});
	}
}

function isValidSignalingMessage(message: unknown): message is SignalingMessage {
	if (!message || typeof message !== "object") return false;

	const candidate = message as Partial<SignalingMessage>;
	if (typeof candidate.sessionId !== "string") return false;
	if (typeof candidate.action !== "string") return false;
	if (typeof candidate.timestamp !== "number") return false;
	if (typeof candidate.senderId !== "string") return false;

	switch (candidate.action) {
		case "offer":
		case "answer":
			return typeof candidate.sdp === "string" && isCallType(candidate.callType);
		case "ice-candidate":
			return Boolean(
				candidate.candidate ||
					(Array.isArray(candidate.candidates) && candidate.candidates.length > 0),
			);
		case "hangup":
		case "decline":
			return true;
		default:
			return false;
	}
}

function isCallType(value: unknown): value is CallType {
	return value === "audio" || value === "video";
}

function getHumanReadableMessage(message: SignalingMessage): string {
	switch (message.action) {
		case "offer":
			return `📞 ${message.callType === "video" ? "Video" : "Voice"} call`;
		case "answer":
			return "📞 Call answered";
		case "ice-candidate":
			return "📞 Call connecting...";
		case "hangup":
			return "📞 Call ended";
		case "decline":
			return "📞 Call declined";
	}
}

export function isWebRtcCallPost(post: MattermostPost): post is MattermostPost & CallPost {
	return post.type === SIGNALING_POST_TYPE && isValidSignalingMessage(post.props);
}
