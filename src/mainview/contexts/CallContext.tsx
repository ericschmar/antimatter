import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { CallManager } from "../webrtc/CallManager";
import type {
	CallError,
	CallSession,
	CallState,
	CallStats,
	CallType,
} from "../webrtc/types";

type CallContextValue = {
	callManager: CallManager;
	state: CallState;
	session: CallSession | null;
	localStream: MediaStream | null;
	remoteStream: MediaStream | null;
	error: CallError | null;
	initiateCall: (
		userId: string,
		username: string,
		callType: CallType,
	) => Promise<void>;
	acceptCall: () => Promise<void>;
	declineCall: (reason?: "busy" | "declined") => Promise<void>;
	hangup: () => Promise<void>;
	setAudioMuted: (muted: boolean) => void;
	setVideoEnabled: (enabled: boolean) => void;
	switchMicrophone: (deviceId: string) => Promise<void>;
	switchCamera: (deviceId: string) => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);
const CallStatsContext = createContext<CallStats | null>(null);

export function CallProvider({
	children,
	callManager,
}: {
	children: ReactNode;
	callManager: CallManager;
}) {
	const [state, setState] = useState<CallState>(callManager.getState());
	const [session, setSession] = useState<CallSession | null>(
		callManager.getSession(),
	);
	const [localStream, setLocalStream] = useState<MediaStream | null>(
		callManager.getLocalStream(),
	);
	const [remoteStream, setRemoteStream] = useState<MediaStream | null>(
		callManager.getRemoteStream(),
	);
	const [stats, setStats] = useState<CallStats | null>(null);
	const [error, setError] = useState<CallError | null>(null);

	useEffect(() => {
		callManager.on("onStateChange", (newState) => {
			setState(newState);
			setSession(callManager.getSession());
			setLocalStream(callManager.getLocalStream());
			setRemoteStream(callManager.getRemoteStream());
		});
		callManager.on("onRemoteStream", setRemoteStream);
		callManager.on("onStatsUpdate", setStats);
		callManager.on("onError", setError);
		callManager.on("onCallEnded", () => {
			setSession(null);
			setLocalStream(null);
			setRemoteStream(null);
			setStats(null);
			setError(null);
		});
	}, [callManager]);

	useEffect(() => {
		// pagehide fires only once navigation/page-close is actually happening (unlike
		// beforeunload, which runs before the user confirms leaving). destroy()
		// synchronously closes the peer connection and notifies other tabs via the
		// BroadcastChannel; hangup()'s async signaling fetch is unreliable on unload.
		const handleUnload = () => {
			callManager.destroy();
		};
		window.addEventListener("pagehide", handleUnload);
		return () => {
			window.removeEventListener("pagehide", handleUnload);
		};
	}, [callManager]);

	const initiateCall = useCallback(
		async (userId: string, _username: string, callType: CallType) => {
			setError(null);
			await callManager.initiateCall(userId, callType);
		},
		[callManager],
	);

	const acceptCall = useCallback(async () => {
		setError(null);
		await callManager.acceptCall();
	}, [callManager]);

	const declineCall = useCallback(
		async (reason: "busy" | "declined" = "declined") => {
			await callManager.declineCall(reason);
		},
		[callManager],
	);

	const hangup = useCallback(async () => {
		await callManager.hangup();
	}, [callManager]);

	const setAudioMuted = useCallback(
		(muted: boolean) => {
			callManager.setAudioMuted(muted);
		},
		[callManager],
	);

	const setVideoEnabled = useCallback(
		(enabled: boolean) => {
			callManager.setVideoEnabled(enabled);
		},
		[callManager],
	);

	const switchMicrophone = useCallback(
		async (deviceId: string) => {
			await callManager.switchMicrophone(deviceId);
		},
		[callManager],
	);

	const switchCamera = useCallback(
		async (deviceId: string) => {
			await callManager.switchCamera(deviceId);
		},
		[callManager],
	);

	const value = useMemo(
		() => ({
			callManager,
			state,
			session,
			localStream,
			remoteStream,
			error,
			initiateCall,
			acceptCall,
			declineCall,
			hangup,
			setAudioMuted,
			setVideoEnabled,
			switchMicrophone,
			switchCamera,
		}),
		[
			callManager,
			state,
			session,
			localStream,
			remoteStream,
			error,
			initiateCall,
			acceptCall,
			declineCall,
			hangup,
			setAudioMuted,
			setVideoEnabled,
			switchMicrophone,
			switchCamera,
		],
	);

	return (
		<CallContext.Provider value={value}>
			<CallStatsContext.Provider value={stats}>
				{children}
			</CallStatsContext.Provider>
		</CallContext.Provider>
	);
}

export function useCall() {
	const context = useContext(CallContext);
	if (!context) throw new Error("useCall must be used within CallProvider");
	return context;
}

export function useCallStats() {
	return useContext(CallStatsContext);
}
