import { AlertCircle } from "lucide-react";
import { memo } from "react";
import { useCall } from "../contexts/CallContext";
import type { CallError } from "../webrtc/types";
import "./WebRTCCallUI.css";

const errorMessages: Record<CallError["code"], string> = {
	"permission-denied": "Microphone or camera access was denied. Check your permissions and try again.",
	"network-error": "Network error. Check your connection and try again.",
	"peer-error": "Call connection failed. Try again.",
	timeout: "Call timed out.",
	unknown: "Call failed. Try again.",
};

export const CallErrorToast = memo(function CallErrorToast() {
	const { error } = useCall();
	if (!error) return null;

	return (
		<div className="call-error-toast" role="alert">
			<AlertCircle size={18} />
			<span>{errorMessages[error.code]}</span>
		</div>
	);
});
