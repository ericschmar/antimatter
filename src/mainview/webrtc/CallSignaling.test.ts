import { describe, expect, test } from "bun:test";
import type { MattermostApiClient } from "../mattermostApi";
import type { MattermostPost } from "../types";
import { CallSignaling, isWebRtcCallPost } from "./CallSignaling";
import type { SignalingMessage } from "./types";

const api = {
	createDirectChannel: async () => ({ id: "dm-channel" }),
	createCustomPost: async () => ({}),
} as unknown as MattermostApiClient;

function captureMessages() {
	const received: Array<{ message: SignalingMessage; channelId: string }> = [];
	const onMessage = (message: SignalingMessage, channelId: string) => {
		received.push({ message, channelId });
	};
	return { received, onMessage };
}

function offerPost(
	senderId: string,
	overrides: Partial<SignalingMessage> = {},
): MattermostPost {
	return {
		id: "post-1",
		create_at: 0,
		update_at: 0,
		delete_at: 0,
		user_id: senderId,
		channel_id: "channel-1",
		message: "call",
		type: "custom_webrtc_call",
		props: {
			action: "offer",
			sessionId: "session-1",
			timestamp: Date.now(),
			senderId,
			sdp: "offer-sdp",
			callType: "audio",
			...overrides,
		},
	};
}

function icePost(senderId: string, sessionId = "session-1"): MattermostPost {
	return {
		id: "post-2",
		create_at: 0,
		update_at: 0,
		delete_at: 0,
		user_id: senderId,
		channel_id: "channel-1",
		message: "call",
		type: "custom_webrtc_call",
		props: {
			action: "ice-candidate",
			sessionId,
			timestamp: Date.now(),
			senderId,
			candidate: { candidate: "ice", sdpMid: "0", sdpMLineIndex: 0 },
		},
	};
}

describe("CallSignaling.handlePost", () => {
	test("ignores posts that are not signaling posts", () => {
		const { received, onMessage } = captureMessages();
		const signaling = new CallSignaling(api, "me", onMessage);

		const result = signaling.handlePost({
			...offerPost("bob"),
			type: "regular-post",
		});

		expect(result).toBe(false);
		expect(received).toHaveLength(0);
	});

	test("ignores signaling posts whose props fail validation", () => {
		const { received, onMessage } = captureMessages();
		const signaling = new CallSignaling(api, "me", onMessage);

		const result = signaling.handlePost({
			...offerPost("bob"),
			props: { action: "offer", sessionId: "session-1" },
		});

		expect(result).toBe(false);
		expect(received).toHaveLength(0);
	});

	test("ignores offers older than the max age", () => {
		const { received, onMessage } = captureMessages();
		const signaling = new CallSignaling(api, "me", onMessage);

		const result = signaling.handlePost(
			offerPost("bob", { timestamp: Date.now() - 120_000 }),
		);

		expect(result).toBe(false);
		expect(received).toHaveLength(0);
	});

	test("forwards an offer from a NEW caller even when a different partner is active (busy routing)", () => {
		const { received, onMessage } = captureMessages();
		const signaling = new CallSignaling(api, "me", onMessage);

		const result = signaling.handlePost(
			offerPost("new-caller"),
			"current-partner",
		);

		expect(result).toBe(true);
		expect(received).toHaveLength(1);
		expect(received[0]?.message.action).toBe("offer");
		expect(received[0]?.message.senderId).toBe("new-caller");
	});

	test("drops mid-call messages from a sender other than the active partner", () => {
		const { received, onMessage } = captureMessages();
		const signaling = new CallSignaling(api, "me", onMessage);

		const result = signaling.handlePost(icePost("stranger"), "current-partner");

		expect(result).toBe(false);
		expect(received).toHaveLength(0);
	});

	test("forwards mid-call messages from the active partner", () => {
		const { received, onMessage } = captureMessages();
		const signaling = new CallSignaling(api, "me", onMessage);

		const result = signaling.handlePost(
			icePost("current-partner"),
			"current-partner",
		);

		expect(result).toBe(true);
		expect(received).toHaveLength(1);
	});
});

describe("isWebRtcCallPost", () => {
	test("returns true for a well-formed call post", () => {
		expect(isWebRtcCallPost(offerPost("bob"))).toBe(true);
	});

	test("returns false for a regular post", () => {
		expect(
			isWebRtcCallPost({ ...offerPost("bob"), type: "regular-post" }),
		).toBe(false);
	});

	test("returns false for a call post whose props fail validation", () => {
		expect(
			isWebRtcCallPost({ ...offerPost("bob"), props: { action: "offer" } }),
		).toBe(false);
	});
});
