import type { CallError } from "./types";

export type AvailableMediaDevices = {
	microphones: MediaDeviceInfo[];
	cameras: MediaDeviceInfo[];
	speakers: MediaDeviceInfo[];
};

export class MediaDevicesManager {
	private stream: MediaStream | null = null;

	async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia(constraints);
			return this.stream;
		} catch (error) {
			throw this.toCallError(error);
		}
	}

	async getDevices(): Promise<AvailableMediaDevices> {
		const devices = await navigator.mediaDevices.enumerateDevices();

		return {
			microphones: devices.filter((device) => device.kind === "audioinput"),
			cameras: devices.filter((device) => device.kind === "videoinput"),
			speakers: devices.filter((device) => device.kind === "audiooutput"),
		};
	}

	async checkPermissions(): Promise<{
		microphone: PermissionState;
		camera: PermissionState;
	}> {
		const [microphone, camera] = await Promise.all([
			navigator.permissions.query({ name: "microphone" as PermissionName }),
			navigator.permissions.query({ name: "camera" as PermissionName }),
		]);

		return {
			microphone: microphone.state,
			camera: camera.state,
		};
	}

	async switchMicrophone(
		deviceId: string,
		peerConnection?: RTCPeerConnection,
	): Promise<MediaStreamTrack> {
		if (!this.stream) throw new Error("No active stream");

		const oldAudioTrack = this.stream.getAudioTracks()[0];
		const newStream = await navigator.mediaDevices.getUserMedia({
			audio: { deviceId: { exact: deviceId } },
			video: false,
		});
		const newAudioTrack = newStream.getAudioTracks()[0];

		const sender = peerConnection
			?.getSenders()
			.find((candidate) => candidate.track?.kind === "audio");
		await sender?.replaceTrack(newAudioTrack);

		if (oldAudioTrack) {
			this.stream.removeTrack(oldAudioTrack);
			oldAudioTrack.stop();
		}
		this.stream.addTrack(newAudioTrack);

		return newAudioTrack;
	}

	async switchCamera(
		deviceId: string,
		peerConnection?: RTCPeerConnection,
	): Promise<MediaStreamTrack> {
		if (!this.stream) throw new Error("No active stream");

		const oldVideoTrack = this.stream.getVideoTracks()[0];
		if (!oldVideoTrack) throw new Error("No active video track");

		const newStream = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: { deviceId: { exact: deviceId } },
		});
		const newVideoTrack = newStream.getVideoTracks()[0];

		const sender = peerConnection
			?.getSenders()
			.find((candidate) => candidate.track?.kind === "video");
		await sender?.replaceTrack(newVideoTrack);

		this.stream.removeTrack(oldVideoTrack);
		oldVideoTrack.stop();
		this.stream.addTrack(newVideoTrack);

		return newVideoTrack;
	}

	cleanup(): void {
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
	}

	getStream(): MediaStream | null {
		return this.stream;
	}

	private toCallError(error: unknown): CallError {
		if (error instanceof Error) {
			if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
				return {
					code: "permission-denied",
					message: "Microphone or camera permission denied.",
					fatal: true,
				};
			}
			if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
				return {
					code: "permission-denied",
					message: "No matching media device found.",
					fatal: true,
				};
			}
			return {
				code: "unknown",
				message: error.message,
				fatal: true,
			};
		}

		return {
			code: "unknown",
			message: "Failed to access media devices.",
			fatal: true,
		};
	}
}
