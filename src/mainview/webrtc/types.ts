export type CallState =
	| "idle"
	| "initiating"
	| "ringing"
	| "incoming"
	| "connecting"
	| "connected"
	| "disconnecting"
	| "failed";

export type CallType = "audio" | "video";

export type CallDirection = "outgoing" | "incoming";

export type SignalingAction =
	| "offer"
	| "answer"
	| "ice-candidate"
	| "hangup"
	| "decline";

export type CallSession = {
	sessionId: string;
	channelId: string;
	otherUserId: string;
	direction: CallDirection;
	callType: CallType;
	state: CallState;
	startedAt: number;
	connectedAt?: number;
};

export type SignalingMessage = {
	action: SignalingAction;
	sessionId: string;
	timestamp: number;
	senderId: string;
	sdp?: string;
	callType?: CallType;
	candidate?: RTCIceCandidateInit;
	candidates?: RTCIceCandidateInit[];
	reason?: "busy" | "declined" | "timeout";
};

export type TabCoordinationMessage = {
	type: "call-accepted" | "call-declined" | "call-ended";
	sessionId: string;
	timestamp: number;
};

export type CallPost = {
	type: "custom_webrtc_call";
	props: SignalingMessage;
	channel_id: string;
	message: string;
};

export type CallStats = {
	duration: number;
	bytesSent: number;
	bytesReceived: number;
	packetsLost: number;
	jitter: number;
	roundTripTime: number;
	audioLevel: number;
};

export type CallConfig = {
	iceServers: RTCIceServer[];
	answerTimeout: number;
	offerTimeout: number;
	enableAudioProcessing: boolean;
	enableVideoCodec: string;
};

export type CallEvents = {
	onStateChange: (state: CallState) => void;
	onRemoteStream: (stream: MediaStream) => void;
	onStatsUpdate: (stats: CallStats) => void;
	onError: (error: CallError) => void;
	onCallEnded: (reason: string) => void;
};

export type CallError = {
	code: "permission-denied" | "network-error" | "peer-error" | "timeout" | "unknown";
	message: string;
	fatal: boolean;
};
