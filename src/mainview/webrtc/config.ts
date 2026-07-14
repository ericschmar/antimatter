import type { CallConfig } from "./types";

export const DEFAULT_CALL_CONFIG: CallConfig = {
	iceServers: [
		{ urls: "stun:stun.l.google.com:19302" },
		{ urls: "stun:stun1.l.google.com:19302" },
		{ urls: "stun:stun2.l.google.com:19302" },
		{ urls: "stun:stun3.l.google.com:19302" },
		{ urls: "stun:stun4.l.google.com:19302" },
	],
	answerTimeout: 45_000,
	offerTimeout: 60_000,
	enableAudioProcessing: true,
	enableVideoCodec: "VP8",
};

export function addTurnServer(
	config: CallConfig,
	urls: string | string[],
	username?: string,
	credential?: string,
): CallConfig {
	return {
		...config,
		iceServers: [
			...config.iceServers,
			{
				urls,
				username,
				credential,
			},
		],
	};
}

export const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
	audio: {
		echoCancellation: true,
		noiseSuppression: true,
		autoGainControl: true,
		sampleRate: 48000,
	},
	video: false,
};

export const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
	audio: {
		echoCancellation: true,
		noiseSuppression: true,
		autoGainControl: true,
		sampleRate: 48000,
	},
	video: {
		width: { ideal: 1280 },
		height: { ideal: 720 },
		frameRate: { ideal: 30 },
		facingMode: "user",
	},
};
