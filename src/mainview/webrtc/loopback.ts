import type { MattermostChannel, MattermostPost } from "../types";
import type { SignalingApi, SignalingPostInput } from "./CallSignaling";
import { DEFAULT_CALL_CONFIG } from "./config";
import type { CallConfig, CallType, SignalingMessage } from "./types";

const LOOPBACK_CHANNEL_ID = "loopback-channel";

type AudioContextWindow = Window & {
	webkitAudioContext?: typeof AudioContext;
};

const loopbackAudioContexts = new Set<AudioContext>();

export type LoopbackCallManager = {
	handleIncomingPost(post: MattermostPost): void;
};

export function createLoopbackPeer(
	currentUserId: string,
	config: Partial<CallConfig> = {},
) {
	return new LoopbackPeer(currentUserId, config);
}

export async function createLoopbackMediaStream(
	callType: CallType,
): Promise<MediaStream> {
	const stream = new MediaStream();
	stream.addTrack(await createLoopbackAudioTrack());
	if (callType === "video") stream.addTrack(createLoopbackVideoTrack());
	return stream;
}

async function createLoopbackAudioTrack(): Promise<MediaStreamTrack> {
	const AudioContextCtor =
		window.AudioContext || (window as AudioContextWindow).webkitAudioContext;
	if (!AudioContextCtor) throw new Error("AudioContext is unavailable");
	const audioContext = new AudioContextCtor();
	loopbackAudioContexts.add(audioContext);
	const oscillator = audioContext.createOscillator();
	const gain = audioContext.createGain();
	const destination = audioContext.createMediaStreamDestination();
	gain.gain.value = 0.08;
	oscillator.frequency.value = 440;
	oscillator.connect(gain);
	gain.connect(destination);
	oscillator.start();
	await audioContext.resume();
	const track = destination.stream.getAudioTracks()[0];
	if (!track) {
		oscillator.stop();
		void audioContext.close();
		loopbackAudioContexts.delete(audioContext);
		throw new Error("AudioContext did not produce an audio track");
	}
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		oscillator.stop();
		void audioContext.close();
		loopbackAudioContexts.delete(audioContext);
	};
	const nativeStop = track.stop;
	const stop =
		typeof nativeStop === "function" ? () => nativeStop.call(track) : undefined;
	track.stop = () => {
		close();
		stop?.();
	};
	track.addEventListener("ended", close);
	return track;
}

function createLoopbackVideoTrack(): MediaStreamTrack {
	const canvas = document.createElement("canvas");
	canvas.width = 1280;
	canvas.height = 720;
	const context = canvas.getContext("2d");
	const draw = () => {
		if (!context) return;
		const hue = Math.floor((Date.now() / 20) % 360);
		context.fillStyle = `hsl(${hue}, 70%, 35%)`;
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = "rgba(0, 0, 0, 0.45)";
		context.fillRect(80, 80, 1120, 560);
		context.fillStyle = "white";
		context.font = "64px ui-sans-serif, system-ui, sans-serif";
		context.fillText("Antimatter loopback", 160, 240);
		context.font = "40px ui-monospace, monospace";
		context.fillText(new Date().toLocaleTimeString(), 160, 330);
		window.requestAnimationFrame(draw);
	};
	draw();
	return canvas.captureStream(30).getVideoTracks()[0];
}

export class LoopbackPeer {
	readonly signalingApi: SignalingApi;
	private callManager: LoopbackCallManager | null = null;
	private peerConnection: RTCPeerConnection | null = null;
	private stream: MediaStream | null = null;
	private postId = 0;
	private config: CallConfig;
	private pendingIceCandidates: RTCIceCandidateInit[] = [];

	constructor(
		private currentUserId: string,
		config: Partial<CallConfig> = {},
	) {
		this.config = { ...DEFAULT_CALL_CONFIG, ...config };
		this.signalingApi = {
			createDirectChannel: async () => {
				return { id: LOOPBACK_CHANNEL_ID } as MattermostChannel;
			},
			createCustomPost: async (post) => {
				const storedPost = this.toPost(post, this.currentUserId);
				await this.handleLocalMessage(post.props, post.channelId);
				return storedPost;
			},
		};
	}

	attach(callManager: LoopbackCallManager): void {
		this.callManager = callManager;
	}

	async handleLocalMessage(
		message: SignalingMessage,
		channelId = LOOPBACK_CHANNEL_ID,
	): Promise<void> {
		switch (message.action) {
			case "offer":
				await this.answerOffer(message, channelId);
				break;
			case "ice-candidate":
				await this.addIceCandidates(message);
				break;
			case "hangup":
			case "decline":
				this.cleanup();
				break;
			case "answer":
				break;
		}
	}

	destroy(): void {
		this.cleanup();
	}

	private async answerOffer(
		message: SignalingMessage,
		channelId: string,
	): Promise<void> {
		if (!message.sdp || !message.callType) return;

		this.cleanup();
		this.peerConnection = new RTCPeerConnection({
			iceServers: this.config.iceServers,
		});
		this.peerConnection.onicecandidate = (event) => {
			if (!event.candidate) return;
			this.deliver(
				{
					action: "ice-candidate",
					sessionId: message.sessionId,
					timestamp: Date.now(),
					senderId: this.currentUserId,
					candidate: event.candidate.toJSON(),
				},
				channelId,
			);
		};

		this.stream = await createLoopbackMediaStream(message.callType);
		for (const track of this.stream.getTracks()) {
			this.peerConnection.addTrack(track, this.stream);
		}
		await this.peerConnection.setRemoteDescription({
			type: "offer",
			sdp: message.sdp,
		});
		await this.flushPendingIceCandidates();
		const answer = await this.peerConnection.createAnswer();
		await this.peerConnection.setLocalDescription(answer);
		if (!answer.sdp) return;
		this.deliver(
			{
				action: "answer",
				sessionId: message.sessionId,
				timestamp: Date.now(),
				senderId: this.currentUserId,
				sdp: answer.sdp,
				callType: message.callType,
			},
			channelId,
		);
	}

	private async addIceCandidates(message: SignalingMessage): Promise<void> {
		const candidates =
			message.candidates ?? (message.candidate ? [message.candidate] : []);
		for (const candidate of candidates) {
			if (!this.peerConnection?.remoteDescription) {
				this.pendingIceCandidates.push(candidate);
				continue;
			}
			await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
		}
	}

	private async flushPendingIceCandidates(): Promise<void> {
		const candidates = this.pendingIceCandidates;
		this.pendingIceCandidates = [];
		for (const candidate of candidates) {
			await this.peerConnection?.addIceCandidate(
				new RTCIceCandidate(candidate),
			);
		}
	}

	private deliver(message: SignalingMessage, channelId: string): void {
		this.callManager?.handleIncomingPost(
			this.toPost(
				{
					channelId,
					message: "loopback call",
					type: "custom_webrtc_call",
					props: { ...message, from_webhook: "true" },
				},
				this.currentUserId,
			),
		);
	}

	private toPost(post: SignalingPostInput, senderId: string): MattermostPost {
		const now = Date.now();
		this.postId += 1;
		return {
			id: `loopback-${this.postId}`,
			create_at: now,
			update_at: now,
			delete_at: 0,
			user_id: senderId,
			channel_id: post.channelId,
			message: post.message,
			type: post.type,
			props: post.props,
		};
	}

	private cleanup(): void {
		this.peerConnection?.close();
		this.peerConnection = null;
		this.stream?.getTracks().forEach((track) => {
			track.stop();
		});
		this.stream = null;
		this.pendingIceCandidates = [];
	}
}
