import { Phone, Video } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { useCall } from "../contexts/CallContext";
import "./WebRTCCallUI.css";

type IncomingCallToastProps = {
	callerName: string;
	callerAvatar?: string;
};

export const IncomingCallToast = memo(function IncomingCallToast({
	callerName,
	callerAvatar,
}: IncomingCallToastProps) {
	const { state, session, acceptCall, declineCall } = useCall();
	const [countdown, setCountdown] = useState(45);
	const isIncoming = state === "incoming" && Boolean(session);
	const Icon = session?.callType === "video" ? Video : Phone;

	useEffect(() => {
		if (!isIncoming) {
			setCountdown(45);
			return;
		}

		const interval = window.setInterval(() => {
			setCountdown((current) => Math.max(0, current - 1));
		}, 1000);

		return () => window.clearInterval(interval);
	}, [isIncoming]);

	const handleDecline = useCallback(() => {
		void declineCall("declined");
	}, [declineCall]);

	const handleAccept = useCallback(() => {
		void acceptCall();
	}, [acceptCall]);

	if (!isIncoming || !session) return null;

	return (
		<div className="incoming-call-toast" role="status">
			<div className="call-toast-header">
				<Icon className="call-icon" size={18} />
				<span className="call-type">
					{session.callType === "video" ? "Video" : "Voice"} call
				</span>
				<span className="call-countdown">{countdown}s</span>
			</div>

			<div className="call-toast-body">
				{callerAvatar ? (
					<img alt={callerName} className="caller-avatar" src={callerAvatar} />
				) : null}
				<div className="caller-info">
					<div className="caller-name">{callerName}</div>
					<div className="caller-status">is calling...</div>
				</div>
			</div>

			<div className="call-toast-actions">
				<button className="call-decline-button" type="button" onClick={handleDecline}>
					Decline
				</button>
				<button className="call-accept-button" type="button" onClick={handleAccept}>
					Accept
				</button>
			</div>
		</div>
	);
});
