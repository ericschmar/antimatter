import { afterEach, describe, expect, test } from "bun:test";
import type { MattermostPost } from "../types";
import { createLoopbackMediaStream, createLoopbackPeer } from "./loopback";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalMediaStream = Object.getOwnPropertyDescriptor(
	globalThis,
	"MediaStream",
);

afterEach(() => {
	if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
	else Reflect.deleteProperty(globalThis, "window");
	if (originalMediaStream)
		Object.defineProperty(globalThis, "MediaStream", originalMediaStream);
	else Reflect.deleteProperty(globalThis, "MediaStream");
});

describe("LoopbackPeer", () => {
	test("cleans up audio tracks when the renderer does not implement track.stop", async () => {
		let oscillatorStopped = false;
		let audioContextClosed = false;
		const track = {
			addEventListener: () => {},
		} as unknown as MediaStreamTrack;

		class MockAudioContext {
			createOscillator() {
				return {
					connect: () => {},
					start: () => {},
					stop: () => {
						oscillatorStopped = true;
					},
					frequency: { value: 0 },
				};
			}

			createGain() {
				return {
					connect: () => {},
					gain: { value: 0 },
				};
			}

			createMediaStreamDestination() {
				return {
					stream: {
						getAudioTracks: () => [track],
					},
				};
			}

			async resume() {}

			async close() {
				audioContextClosed = true;
			}
		}

		class MockMediaStream {
			private tracks: MediaStreamTrack[] = [];

			addTrack(mediaTrack: MediaStreamTrack) {
				this.tracks.push(mediaTrack);
			}

			getAudioTracks() {
				return this.tracks;
			}
		}

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { AudioContext: MockAudioContext },
		});
		Object.defineProperty(globalThis, "MediaStream", {
			configurable: true,
			value: MockMediaStream,
		});

		const stream = await createLoopbackMediaStream("audio");
		stream.getAudioTracks()[0]?.stop();

		expect(oscillatorStopped).toBe(true);
		expect(audioContextClosed).toBe(true);
	});

	test("uses a stable loopback direct channel", async () => {
		const peer = createLoopbackPeer("me");

		await expect(
			peer.signalingApi.createDirectChannel(["me", "me"]),
		).resolves.toMatchObject({
			id: "loopback-channel",
		});
	});

	test("stores local signaling posts with the current user as sender", async () => {
		const peer = createLoopbackPeer("me");
		peer.handleLocalMessage = async () => {};

		const post = await peer.signalingApi.createCustomPost({
			channelId: "loopback-channel",
			message: "call",
			type: "custom_webrtc_call",
			props: {
				action: "hangup",
				sessionId: "session-1",
				timestamp: Date.now(),
				senderId: "me",
			},
		});

		expect(post.user_id).toBe("me");
		expect(post.channel_id).toBe("loopback-channel");
		expect(post.type).toBe("custom_webrtc_call");
	});

	test("delivers synthetic remote posts to the attached call manager", () => {
		const peer = createLoopbackPeer("me");
		const received: MattermostPost[] = [];
		peer.attach({ handleIncomingPost: (post) => received.push(post) });

		peer["deliver"](
			{
				action: "answer",
				sessionId: "session-1",
				timestamp: Date.now(),
				senderId: "me",
				sdp: "answer-sdp",
				callType: "audio",
			},
			"loopback-channel",
		);

		expect(received).toHaveLength(1);
		expect(received[0]?.user_id).toBe("me");
		expect(received[0]?.props?.["action"]).toBe("answer");
	});

	test("buffers local ICE candidates until the remote description is set", async () => {
		const added: RTCIceCandidateInit[] = [];
		const peer = createLoopbackPeer("me");
		peer["peerConnection"] = {
			remoteDescription: null,
			addIceCandidate: async (candidate: RTCIceCandidate) => {
				added.push(candidate.toJSON());
			},
		} as RTCPeerConnection;

		await peer.handleLocalMessage({
			action: "ice-candidate",
			sessionId: "session-1",
			timestamp: Date.now(),
			senderId: "me",
			candidate: { candidate: "ice", sdpMid: "0", sdpMLineIndex: 0 },
		});

		expect(added).toHaveLength(0);
		expect(peer["pendingIceCandidates"]).toHaveLength(1);
	});
});
