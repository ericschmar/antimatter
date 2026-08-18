import { describe, expect, test } from "bun:test";
import type { MattermostRpcResponse } from "../../shared/electrobunRpc";
import type { MattermostApiClient } from "../mattermostApi";
import type { ChatHistoryClient } from "./chatHistoryClient";
import { createChatHistoryClient } from "./chatHistoryClient";
import type {
	MainToWorkerMessage,
	WorkerToMainMessage,
} from "./chatHistoryProtocol";

class FakeWorker {
	posted: unknown[] = [];
	terminated = false;
	onmessage: ((event: { data: MainToWorkerMessage }) => void) | null = null;

	postMessage(message: unknown) {
		this.posted.push(message);
	}

	terminate() {
		this.terminated = true;
	}

	// Test helper: deliver a worker→main message.
	deliver(message: WorkerToMainMessage) {
		this.onmessage?.({ data: message as never });
	}
}

function okResponse(body: unknown): MattermostRpcResponse {
	return { status: 200, ok: true, body };
}

function fallbackApi(calls: string[]): MattermostApiClient {
	return {
		getPostsForChannel: async (channelId: string) => {
			calls.push(`posts:${channelId}`);
			return { order: ["p1"], posts: {}, prev_post_id: "" } as never;
		},
		getChannelMembers: async () => [] as never,
		getUsersByIds: async () => [] as never,
	} as unknown as MattermostApiClient;
}

function setup(options: { createWorker?: () => Promise<Worker> } = {}) {
	const worker = new FakeWorker();
	const calls: string[] = [];
	const brokerCalls: { path: string; method?: string; body?: unknown }[] = [];
	const client: ChatHistoryClient = createChatHistoryClient({
		api: fallbackApi(calls),
		broker: async (call) => {
			brokerCalls.push(call);
			return okResponse({ relayed: call.path });
		},
		createWorker:
			options.createWorker ?? (async () => worker as unknown as Worker),
	});
	return { client, worker, calls, brokerCalls };
}

describe("createChatHistoryClient", () => {
	test("posts loadHistory and resolves on historyLoaded", async () => {
		const { client, worker } = setup();

		const pending = client.loadChannelHistory("ch1", "me");
		await new Promise((r) => setTimeout(r, 1));

		expect(worker.posted).toEqual([
			{
				kind: "loadHistory",
				requestId: 1,
				channelId: "ch1",
				currentUserId: "me",
				priority: "user",
			},
		]);

		worker.deliver({
			kind: "historyLoaded",
			requestId: 1,
			channelId: "ch1",
			data: {
				memberUsers: [],
				members: [],
				postOrder: ["p1"],
				posts: {},
				postUsers: [],
			},
			hasMore: true,
			fromCache: false,
		});

		await expect(pending).resolves.toMatchObject({ hasMore: true });
	});

	test("relays rpc calls through the broker with credentials injected main-side", async () => {
		const { client, worker, brokerCalls } = setup();

		void client.loadChannelHistory("ch1");
		await new Promise((r) => setTimeout(r, 1));
		worker.deliver({
			kind: "rpcCall",
			requestId: 1,
			path: "/channels/ch1/posts",
			method: "GET",
		});
		await new Promise((r) => setTimeout(r, 1));

		expect(brokerCalls).toEqual([
			{ path: "/channels/ch1/posts", method: "GET" },
		]);
		expect(worker.posted[1]).toEqual({
			kind: "rpcResult",
			requestId: 1,
			ok: true,
			status: 200,
			body: { relayed: "/channels/ch1/posts" },
		});
	});

	test("rejects with a MattermostApiError preserving status", async () => {
		const { client, worker } = setup();

		const pending = client.loadChannelHistory("ch1");
		await new Promise((r) => setTimeout(r, 1));
		worker.deliver({
			kind: "historyError",
			requestId: 1,
			channelId: "ch1",
			message: "forbidden",
			status: 403,
		});

		const error = await pending.then(
			() => null,
			(e) => e,
		);
		expect(error?.name).toBe("MattermostApiError");
		expect(error?.status).toBe(403);
	});

	test("falls back to the main-thread waterfall when worker creation fails", async () => {
		const calls: string[] = [];
		const client = createChatHistoryClient({
			api: fallbackApi(calls),
			broker: async () => okResponse({}),
			createWorker: async () => {
				throw new Error("no workers here");
			},
		});

		const result = await client.loadChannelHistory("ch1", "me");

		expect(calls).toEqual(["posts:ch1"]);
		expect(result.data.postOrder).toEqual(["p1"]);
	});

	test("falls back when the first worker request exceeds the handshake timeout", async () => {
		const calls: string[] = [];
		const worker = new FakeWorker();
		const client = createChatHistoryClient({
			api: fallbackApi(calls),
			broker: async () => okResponse({}),
			createWorker: async () => worker as unknown as Worker,
			handshakeTimeoutMs: 5,
		});

		const result = await client.loadChannelHistory("ch1", "me");

		// Worker went silent: fallback answered and the worker was retired.
		expect(calls).toEqual(["posts:ch1"]);
		expect(worker.terminated).toBe(true);
		expect(result.data.postOrder).toEqual(["p1"]);
	});

	test("forwards background refreshes via onBackgroundHistory", async () => {
		const { client, worker } = setup();
		const background: { channelId: string; hasMore: boolean }[] = [];
		client.onBackgroundHistory = (channelId, _data, hasMore) => {
			background.push({ channelId, hasMore });
		};

		void client.loadChannelHistory("ch1");
		await new Promise((r) => setTimeout(r, 1));
		worker.deliver({
			kind: "historyLoaded",
			requestId: 0,
			channelId: "ch1",
			data: {
				memberUsers: [],
				members: [],
				postOrder: [],
				posts: {},
				postUsers: [],
			},
			hasMore: false,
			fromCache: false,
		});
		await new Promise((r) => setTimeout(r, 1));

		expect(background).toEqual([{ channelId: "ch1", hasMore: false }]);
	});

	test("forwards prefetched histories through the background callback", async () => {
		const { client, worker } = setup();
		const background: string[] = [];
		client.onBackgroundHistory = (channelId) => background.push(channelId);
		void client.loadChannelHistory("ch1");
		await new Promise((r) => setTimeout(r, 1));

		worker.deliver({
			kind: "historyPrefetched",
			channelId: "ch2",
			data: {
				memberUsers: [],
				members: [],
				postOrder: ["p2"],
				posts: {},
				postUsers: [],
			},
			hasMore: false,
		});

		expect(background).toEqual(["ch2"]);
	});

	test("posts predictive prefetch signals after the worker is available", async () => {
		const { client, worker } = setup();
		void client.loadChannelHistory("ch1");
		await new Promise((r) => setTimeout(r, 1));

		client.recordVisit("ch1", 10);
		client.updateSignals({
			candidates: [],
			currentChannelId: "ch1",
			selectedChannelLoading: false,
			websocketConnected: true,
		});

		expect(worker.posted.slice(1)).toEqual([
			{ kind: "recordVisit", channelId: "ch1", at: 10 },
			{
				kind: "updateSignals",
				signals: {
					candidates: [],
					currentChannelId: "ch1",
					selectedChannelLoading: false,
					websocketConnected: true,
				},
			},
		]);
	});

	test("invalidate posts an invalidate message", async () => {
		const { client, worker } = setup();

		void client.loadChannelHistory("ch1");
		await new Promise((r) => setTimeout(r, 1));
		client.invalidate("ch1");

		expect(worker.posted[1]).toEqual({ kind: "invalidate", channelId: "ch1" });
	});

	test("reset terminates the worker and rejects pending loads", async () => {
		const { client, worker } = setup();

		const pending = client.loadChannelHistory("ch1");
		await new Promise((r) => setTimeout(r, 1));
		client.reset();

		expect(worker.terminated).toBe(true);
		await expect(pending).rejects.toThrow("reset");
	});
});
