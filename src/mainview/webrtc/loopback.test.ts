import { describe, expect, test } from "bun:test";
import type { MattermostPost } from "../types";
import { createLoopbackPeer } from "./loopback";

describe("LoopbackPeer", () => {
	test("uses a stable loopback direct channel", async () => {
		const peer = createLoopbackPeer("me");

		await expect(peer.signalingApi.createDirectChannel(["me", "me"])).resolves.toMatchObject({
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
