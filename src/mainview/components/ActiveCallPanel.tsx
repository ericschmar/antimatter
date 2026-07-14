import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCall, useCallStats } from "../contexts/CallContext";
import "./WebRTCCallUI.css";

type ActiveCallPanelProps = {
	callerName: string;
};

export const ActiveCallPanel = memo(function ActiveCallPanel({
	callerName,
}: ActiveCallPanelProps) {
	const {
		state,
		session,
		localStream,
		remoteStream,
		hangup,
		setAudioMuted,
		setVideoEnabled,
	} = useCall();
	const stats = useCallStats();
	const [muted, setMuted] = useState(false);
	const [videoOff, setVideoOff] = useState(false);
	const localVideoRef = useRef<HTMLVideoElement | null>(null);
	const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
	const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
	const duration = useMemo(
		() => formatDuration(stats?.duration ?? 0),
		[stats?.duration],
	);
	const isVideoCall = session?.callType === "video";

	useEffect(() => {
		if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
	}, [localStream]);

	useEffect(() => {
		const stream = remoteStream;
		if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
		if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
	}, [remoteStream]);

	const toggleMute = useCallback(() => {
		setMuted((current) => {
			const next = !current;
			setAudioMuted(next);
			return next;
		});
	}, [setAudioMuted]);

	const toggleVideo = useCallback(() => {
		setVideoOff((current) => {
			const next = !current;
			setVideoEnabled(!next);
			return next;
		});
	}, [setVideoEnabled]);

	const handleHangup = useCallback(() => {
		void hangup();
	}, [hangup]);

	if (state !== "connected" || !session) return null;

	return (
		<div className="active-call-panel">
			{isVideoCall ? (
				<div className="call-video-stage">
					<video
						ref={remoteVideoRef}
						autoPlay
						muted
						playsInline
						className="call-video call-video-remote"
					/>
					<video
						ref={localVideoRef}
						autoPlay
						muted
						playsInline
						className="call-video call-video-local"
					/>
				</div>
			) : null}
			{/* Remote audio always plays, including audio-only calls. Local audio is
			    intentionally not attached to avoid hearing yourself. Live WebRTC media
			    has no captions track. */}
			{/* biome-ignore lint/a11y/useMediaCaption: live WebRTC media has no captions track */}
			<audio ref={remoteAudioRef} autoPlay />

			<div className="call-panel-header">
				<div className="call-indicator">
					<span className="call-indicator-dot" />
					<span className="call-with">Call with {callerName}</span>
				</div>
				<div className="call-duration">{duration}</div>
			</div>

			<div className="call-controls">
				<button
					aria-pressed={muted}
					className={`call-control-button${muted ? " active" : ""}`}
					title={muted ? "Unmute" : "Mute"}
					type="button"
					onClick={toggleMute}
				>
					{muted ? <MicOff size={16} /> : <Mic size={16} />}
				</button>

				{isVideoCall ? (
					<button
						aria-pressed={videoOff}
						className={`call-control-button${videoOff ? " active" : ""}`}
						title={videoOff ? "Enable video" : "Disable video"}
						type="button"
						onClick={toggleVideo}
					>
						{videoOff ? <VideoOff size={16} /> : <Video size={16} />}
					</button>
				) : null}

				<button
					className="call-control-button call-hangup-button"
					title="Hang up"
					type="button"
					onClick={handleHangup}
				>
					<PhoneOff size={16} />
				</button>
			</div>

			{stats ? (
				<div className="call-stats">
					<div className="call-stat">
						<span className="call-stat-label">Latency</span>
						<span className="call-stat-value">
							{Math.round(stats.roundTripTime)}ms
						</span>
					</div>
					<div className="call-stat">
						<span className="call-stat-label">Packet loss</span>
						<span className="call-stat-value">{stats.packetsLost}</span>
					</div>
				</div>
			) : null}
		</div>
	);
});

function formatDuration(duration: number) {
	const minutes = Math.floor(duration / 60);
	const seconds = duration % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
