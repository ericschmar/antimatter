import type { MattermostApiClient } from "../mattermostApi";
import { AUDIO_CONSTRAINTS, DEFAULT_CALL_CONFIG, VIDEO_CONSTRAINTS } from "./config";
import { CallSignaling } from "./CallSignaling";
import { MediaDevicesManager } from "./MediaDevices";
import type {
	CallConfig,
	CallError,
	CallEvents,
	CallSession,
	CallState,
	CallStats,
	CallType,
	SignalingMessage,
	TabCoordinationMessage,
} from "./types";

const ACTIVE_CALL_STORAGE_KEY = "antimatter-active-call";
const CALL_TAB_CHANNEL = "antimatter-calls";

export class CallManager {
	private peerConnection: RTCPeerConnection | null = null;
	private mediaManager = new MediaDevicesManager();
	private signaling: CallSignaling;
	private config: CallConfig;
	private currentSession: CallSession | null = null;
	private state: CallState = "idle";
	private statsInterval: number | null = null;
	private answerTimeout: number | null = null;
	private pendingIceCandidates: RTCIceCandidateInit[] = [];
	private remoteStream: MediaStream | null = null;
	private tabChannel: BroadcastChannel;
	private events: Partial<CallEvents> = {};
	private pendingRecoveryError: CallError | null = null;

	constructor(
		mattermostApi: MattermostApiClient,
		private currentUserId: string,
		config: Partial<CallConfig> = {},
	) {
		this.config = { ...DEFAULT_CALL_CONFIG, ...config };
		this.signaling = new CallSignaling(
			mattermostApi,
			currentUserId,
			this.handleSignalingMessage,
		);
		this.tabChannel = new BroadcastChannel(CALL_TAB_CHANNEL);
		this.tabChannel.onmessage = this.handleTabMessage;
		this.checkForOrphanedSession();
	}

	on<K extends keyof CallEvents>(event: K, callback: CallEvents[K]): void {
		this.events[event] = callback;
		if (event === "onError" && this.pendingRecoveryError) {
			this.events.onError?.(this.pendingRecoveryError);
			this.pendingRecoveryError = null;
		}
	}

	async initiateCall(userId: string, callType: CallType): Promise<void> {
		if (this.state !== "idle") throw new Error("Call already in progress");

		this.setState("initiating");

		try {
			const channelId = await this.signaling.getDmChannelId(userId);
			const sessionId = crypto.randomUUID();
			this.currentSession = {
				sessionId,
				channelId,
				otherUserId: userId,
				direction: "outgoing",
				callType,
				state: "initiating",
				startedAt: Date.now(),
			};

			await this.mediaManager.getUserMedia(
				callType === "video" ? VIDEO_CONSTRAINTS : AUDIO_CONSTRAINTS,
			);
			this.createPeerConnection();
			this.addLocalTracks();

			const offer = await this.peerConnection?.createOffer({
				offerToReceiveAudio: true,
				offerToReceiveVideo: callType === "video",
			});
			if (!offer?.sdp) throw new Error("Failed to create call offer");

			await this.peerConnection?.setLocalDescription(offer);
			await this.signaling.send(
				{
					action: "offer",
					sessionId,
					timestamp: Date.now(),
					senderId: this.currentUserId,
					sdp: offer.sdp,
					callType,
				},
				channelId,
			);

			this.setState("ringing");
			this.answerTimeout = window.setTimeout(() => {
				this.handleTimeout("No answer");
			}, this.config.answerTimeout);
		} catch (error) {
			this.handleError(toCallError(error, "Failed to initiate call"));
		}
	}

	async acceptCall(): Promise<void> {
		if (this.state !== "incoming" || !this.currentSession) {
			throw new Error("No incoming call to accept");
		}

		this.tabChannel.postMessage({
			type: "call-accepted",
			sessionId: this.currentSession.sessionId,
			timestamp: Date.now(),
		} satisfies TabCoordinationMessage);

		this.setState("connecting");

		try {
			await this.mediaManager.getUserMedia(
				this.currentSession.callType === "video"
					? VIDEO_CONSTRAINTS
					: AUDIO_CONSTRAINTS,
			);
			this.addLocalTracks();

			const answer = await this.peerConnection?.createAnswer();
			if (!answer?.sdp) throw new Error("Failed to create call answer");

			await this.peerConnection?.setLocalDescription(answer);
			await this.signaling.send(
				{
					action: "answer",
					sessionId: this.currentSession.sessionId,
					timestamp: Date.now(),
					senderId: this.currentUserId,
					sdp: answer.sdp,
					callType: this.currentSession.callType,
				},
				this.currentSession.channelId,
			);
		} catch (error) {
			this.handleError(toCallError(error, "Failed to accept call"));
		}
	}

	async declineCall(reason: "busy" | "declined" = "declined"): Promise<void> {
		if (this.state !== "incoming" || !this.currentSession) {
			throw new Error("No incoming call to decline");
		}

		this.tabChannel.postMessage({
			type: "call-declined",
			sessionId: this.currentSession.sessionId,
			timestamp: Date.now(),
		} satisfies TabCoordinationMessage);

		await this.signaling.send(
			{
				action: "decline",
				sessionId: this.currentSession.sessionId,
				timestamp: Date.now(),
				senderId: this.currentUserId,
				reason,
			},
			this.currentSession.channelId,
		);
		this.cleanup("Call declined");
	}

	async hangup(): Promise<void> {
		if (this.state === "idle") return;

		if (this.currentSession) {
			await this.signaling.send(
				{
					action: "hangup",
					sessionId: this.currentSession.sessionId,
					timestamp: Date.now(),
					senderId: this.currentUserId,
				},
				this.currentSession.channelId,
			);
		}

		this.cleanup("Call ended");
	}

	setAudioMuted(muted: boolean): void {
		this.mediaManager
			.getStream()
			?.getAudioTracks()
			.forEach((track) => {
				track.enabled = !muted;
			});
	}

	setVideoEnabled(enabled: boolean): void {
		this.mediaManager
			.getStream()
			?.getVideoTracks()
			.forEach((track) => {
				track.enabled = enabled;
			});
	}

	getSession(): CallSession | null {
		return this.currentSession;
	}

	getState(): CallState {
		return this.state;
	}

	getLocalStream(): MediaStream | null {
		return this.mediaManager.getStream();
	}

	getRemoteStream(): MediaStream | null {
		return this.remoteStream;
	}

	handleIncomingPost(post: Parameters<CallSignaling["handlePost"]>[0]): void {
		this.signaling.handlePost(post, this.currentSession?.otherUserId);
	}

	async switchMicrophone(deviceId: string): Promise<void> {
		await this.mediaManager.switchMicrophone(
			deviceId,
			this.peerConnection ?? undefined,
		);
	}

	async switchCamera(deviceId: string): Promise<void> {
		await this.mediaManager.switchCamera(deviceId, this.peerConnection ?? undefined);
	}

	destroy(): void {
		this.cleanup("Manager destroyed");
		this.tabChannel.close();
	}

	private createPeerConnection(): void {
		this.peerConnection = new RTCPeerConnection({
			iceServers: this.config.iceServers,
		});
		this.remoteStream = new MediaStream();

		this.peerConnection.onicecandidate = (event) => {
			if (!event.candidate || !this.currentSession) return;

			void this.signaling.send(
				{
					action: "ice-candidate",
					sessionId: this.currentSession.sessionId,
					timestamp: Date.now(),
					senderId: this.currentUserId,
					candidate: event.candidate.toJSON(),
				},
				this.currentSession.channelId,
			);
		};

		this.peerConnection.ontrack = (event) => {
			const stream = this.remoteStream;
			if (!stream) return;

			stream.addTrack(event.track);
			if (this.hasExpectedRemoteTracks(stream)) {
				this.events.onRemoteStream?.(stream);
			}
		};

		this.peerConnection.onconnectionstatechange = () => {
			switch (this.peerConnection?.connectionState) {
				case "connected":
					this.handleConnectionEstablished();
					break;
				case "failed":
					this.handleError({
						code: "peer-error",
						message: "Call connection failed.",
						fatal: true,
					});
					break;
			}
		};

		this.peerConnection.oniceconnectionstatechange = () => {
			if (this.peerConnection?.iceConnectionState === "failed") {
				void this.restartIce();
			}
		};
	}

	private addLocalTracks(): void {
		const stream = this.mediaManager.getStream();
		if (!stream || !this.peerConnection) return;

		for (const track of stream.getTracks()) {
			this.peerConnection.addTrack(track, stream);
		}
	}

	private handleSignalingMessage = (message: SignalingMessage, channelId: string) => {
		void this.handleSignalingMessageAsync(message, channelId);
	};

	private async handleSignalingMessageAsync(
		message: SignalingMessage,
		channelId: string,
	): Promise<void> {
		switch (message.action) {
			case "offer":
				await this.handleOffer(message, channelId);
				break;
			case "answer":
				await this.handleAnswer(message);
				break;
			case "ice-candidate":
				await this.handleIceCandidate(message);
				break;
			case "hangup":
				this.cleanup("Remote party ended the call");
				break;
			case "decline":
				this.cleanup(message.reason ?? "Call declined");
				break;
		}
	}

	private async handleOffer(
		message: SignalingMessage,
		channelId: string,
	): Promise<void> {
		if (!message.sdp || !message.callType) return;

		if (
			this.currentSession &&
			message.sessionId === this.currentSession.sessionId &&
			this.state === "connected"
		) {
			await this.handleRestartOffer(message);
			return;
		}

		if (this.state !== "idle") {
			await this.signaling.send(
				{
					action: "decline",
					sessionId: message.sessionId,
					timestamp: Date.now(),
					senderId: this.currentUserId,
					reason: "busy",
				},
				channelId,
			);
			return;
		}

		try {
			this.currentSession = {
				sessionId: message.sessionId,
				channelId,
				otherUserId: message.senderId,
				direction: "incoming",
				callType: message.callType,
				state: "incoming",
				startedAt: Date.now(),
			};
			this.createPeerConnection();
			await this.peerConnection?.setRemoteDescription({
				type: "offer",
				sdp: message.sdp,
			});
			await this.flushPendingIceCandidates();
			this.setState("incoming");
		} catch (error) {
			this.handleError(toCallError(error, "Failed to process incoming call"));
		}
	}

	private async handleAnswer(message: SignalingMessage): Promise<void> {
		if (!this.currentSession || message.sessionId !== this.currentSession.sessionId) {
			return;
		}
		if (!message.sdp) return;
		if (this.state !== "ringing" && this.state !== "connected") return;

		try {
			await this.peerConnection?.setRemoteDescription({
				type: "answer",
				sdp: message.sdp,
			});
			await this.flushPendingIceCandidates();
			if (this.answerTimeout) {
				window.clearTimeout(this.answerTimeout);
				this.answerTimeout = null;
			}
			if (this.state !== "connected") this.setState("connecting");
		} catch (error) {
			this.handleError(toCallError(error, "Failed to process answer"));
		}
	}

	private async handleRestartOffer(message: SignalingMessage): Promise<void> {
		if (!this.peerConnection || !this.currentSession || !message.sdp) return;

		try {
			await this.peerConnection.setRemoteDescription({
				type: "offer",
				sdp: message.sdp,
			});
			await this.flushPendingIceCandidates();

			const answer = await this.peerConnection.createAnswer();
			if (!answer.sdp) throw new Error("Failed to create ICE restart answer");

			await this.peerConnection.setLocalDescription(answer);
			await this.signaling.send(
				{
					action: "answer",
					sessionId: this.currentSession.sessionId,
					timestamp: Date.now(),
					senderId: this.currentUserId,
					sdp: answer.sdp,
					callType: this.currentSession.callType,
				},
				this.currentSession.channelId,
			);
		} catch (error) {
			this.handleError(toCallError(error, "Failed to process ICE restart"));
		}
	}

	private hasExpectedRemoteTracks(stream: MediaStream): boolean {
		if (!this.currentSession) return false;
		if (stream.getAudioTracks().length === 0) return false;
		return this.currentSession.callType === "audio" || stream.getVideoTracks().length > 0;
	}

	private async handleIceCandidate(message: SignalingMessage): Promise<void> {
		if (!this.currentSession || message.sessionId !== this.currentSession.sessionId) {
			return;
		}
		if (!this.peerConnection) return;

		const candidates = message.candidates ??
			(message.candidate ? [message.candidate] : []);

		if (!this.peerConnection.remoteDescription) {
			this.pendingIceCandidates.push(...candidates);
			return;
		}

		await this.addIceCandidates(candidates);
	}

	private async flushPendingIceCandidates(): Promise<void> {
		const candidates = this.pendingIceCandidates;
		this.pendingIceCandidates = [];
		await this.addIceCandidates(candidates);
	}

	private async addIceCandidates(candidates: RTCIceCandidateInit[]): Promise<void> {
		for (const candidate of candidates) {
			try {
				await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
			} catch {
			}
		}
	}

	private handleConnectionEstablished(): void {
		if (this.currentSession && !this.currentSession.connectedAt) {
			this.currentSession.connectedAt = Date.now();
		}
		this.setState("connected");
		this.saveSessionToStorage();
		this.startStatsCollection();
	}

	private startStatsCollection(): void {
		if (this.statsInterval) return;

		this.statsInterval = window.setInterval(async () => {
			if (!this.peerConnection || this.state !== "connected") return;

			const stats = parseStats(
				await this.peerConnection.getStats(),
				this.currentSession?.connectedAt,
			);
			this.events.onStatsUpdate?.(stats);
		}, 1000);
	}

	private handleTimeout(reason: string): void {
		this.handleError({ code: "timeout", message: reason, fatal: true });
	}

	private handleError(error: CallError): void {
		this.events.onError?.(error);
		if (error.fatal) this.cleanup(error.message);
	}

	private setState(newState: CallState): void {
		if (this.state === newState) return;

		this.state = newState;
		if (this.currentSession) this.currentSession.state = newState;
		this.events.onStateChange?.(newState);
	}

	private async restartIce(): Promise<void> {
		if (!this.peerConnection || !this.currentSession) return;

		try {
			const offer = await this.peerConnection.createOffer({ iceRestart: true });
			if (!offer.sdp) throw new Error("Failed to create ICE restart offer");
			await this.peerConnection.setLocalDescription(offer);
			await this.signaling.send(
				{
					action: "offer",
					sessionId: this.currentSession.sessionId,
					timestamp: Date.now(),
					senderId: this.currentUserId,
					sdp: offer.sdp,
					callType: this.currentSession.callType,
				},
				this.currentSession.channelId,
			);
		} catch (error) {
			this.handleError(toCallError(error, "Failed to restart connection"));
		}
	}

	private handleTabMessage = (event: MessageEvent<TabCoordinationMessage>) => {
		const message = event.data;
		if (!this.currentSession || message.sessionId !== this.currentSession.sessionId) {
			return;
		}

		switch (message.type) {
			case "call-accepted":
				this.cleanup("Call accepted in another tab");
				break;
			case "call-declined":
				this.cleanup("Call declined in another tab");
				break;
			case "call-ended":
				this.cleanup("Call ended in another tab");
				break;
		}
	};

	private checkForOrphanedSession(): void {
		const savedSession = localStorage.getItem(ACTIVE_CALL_STORAGE_KEY);
		if (!savedSession) return;

		try {
			const session = JSON.parse(savedSession) as CallSession;
			if (Date.now() - session.startedAt < 5 * 60 * 1000) {
				this.pendingRecoveryError = {
					code: "unknown",
					message: `You have an active call with ${session.otherUserId}.`,
					fatal: false,
				};
			}
		} finally {
			localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
		}
	}

	private saveSessionToStorage(): void {
		if (this.currentSession && this.state === "connected") {
			localStorage.setItem(
				ACTIVE_CALL_STORAGE_KEY,
				JSON.stringify(this.currentSession),
			);
		}
	}

	private cleanup(reason: string): void {
		if (this.answerTimeout) {
			window.clearTimeout(this.answerTimeout);
			this.answerTimeout = null;
		}
		if (this.statsInterval) {
			window.clearInterval(this.statsInterval);
			this.statsInterval = null;
		}

		if (this.peerConnection) {
			this.peerConnection.onicecandidate = null;
			this.peerConnection.ontrack = null;
			this.peerConnection.onconnectionstatechange = null;
			this.peerConnection.oniceconnectionstatechange = null;
			this.peerConnection.close();
			this.peerConnection = null;
		}

		this.mediaManager.cleanup();
		this.remoteStream = null;
		this.pendingIceCandidates = [];

		if (this.currentSession) {
			this.signaling.cleanup(this.currentSession.sessionId);
			this.tabChannel.postMessage({
				type: "call-ended",
				sessionId: this.currentSession.sessionId,
				timestamp: Date.now(),
			} satisfies TabCoordinationMessage);
		}

		localStorage.removeItem(ACTIVE_CALL_STORAGE_KEY);
		this.currentSession = null;
		this.setState("idle");
		this.events.onCallEnded?.(reason);
	}
}

export function createCallManager(
	mattermostApi: MattermostApiClient,
	currentUserId: string,
	config?: Partial<CallConfig>,
): CallManager {
	return new CallManager(mattermostApi, currentUserId, config);
}

function parseStats(
	stats: RTCStatsReport,
	connectedAt: number | undefined,
): CallStats {
	let bytesSent = 0;
	let bytesReceived = 0;
	let packetsLost = 0;
	let jitter = 0;
	let roundTripTime = 0;
	let audioLevel = 0;

	stats.forEach((report) => {
		if (report.type === "outbound-rtp") {
			bytesSent += report.bytesSent ?? 0;
		}
		if (report.type === "inbound-rtp") {
			bytesReceived += report.bytesReceived ?? 0;
			packetsLost += report.packetsLost ?? 0;
			jitter = report.jitter ?? 0;
		}
		if (report.type === "candidate-pair" && report.state === "succeeded") {
			roundTripTime = report.currentRoundTripTime ?? 0;
		}
		if (report.type === "media-source" && report.kind === "audio") {
			audioLevel = report.audioLevel ?? 0;
		}
	});

	return {
		duration: connectedAt ? Math.floor((Date.now() - connectedAt) / 1000) : 0,
		bytesSent,
		bytesReceived,
		packetsLost,
		jitter: jitter * 1000,
		roundTripTime: roundTripTime * 1000,
		audioLevel,
	};
}

function toCallError(error: unknown, fallbackMessage: string): CallError {
	if (isCallError(error)) return error;

	return {
		code:
			error instanceof Error && error.message.toLowerCase().includes("permission")
				? "permission-denied"
				: "unknown",
		message: error instanceof Error ? error.message : fallbackMessage,
		fatal: true,
	};
}

function isCallError(error: unknown): error is CallError {
	return (
		error !== null &&
		typeof error === "object" &&
		"code" in error &&
		"message" in error &&
		"fatal" in error
	);
}
