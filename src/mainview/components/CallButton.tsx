import { Phone, Video } from "lucide-react";
import { memo, useCallback } from "react";
import type { CallType } from "../webrtc/types";
import { useCall } from "../contexts/CallContext";
import "./WebRTCCallUI.css";

type CallButtonProps = {
	userId: string;
	username: string;
	variant: CallType;
	disabled?: boolean;
};

export const CallButton = memo(function CallButton({
	userId,
	username,
	variant,
	disabled = false,
}: CallButtonProps) {
	const { state, initiateCall } = useCall();
	const isDisabled = disabled || state !== "idle";
	const label = `Start ${variant} call with ${username}`;
	const Icon = variant === "audio" ? Phone : Video;

	const handleClick = useCallback(() => {
		void initiateCall(userId, username, variant);
	}, [initiateCall, userId, username, variant]);

	return (
		<button
			aria-label={label}
			className="call-button"
			disabled={isDisabled}
			title={label}
			type="button"
			onClick={handleClick}
		>
			<Icon size={16} />
		</button>
	);
});
