import { describe, expect, test } from "bun:test";
import type { ChannelHistoryData } from "../types";
import type { WorkerToMainMessage } from "./chatHistoryProtocol";
import { createHistoryCache } from "./historyCache";
import { createLoadQueue } from "./loadQueue";
import { createWorkerCore } from "./workerCore";

function historyData(seed: string): ChannelHistoryData {
	return {
		memberUsers: [],
		members: [],
		postOrder: [seed],
		posts: {},
		postUsers: [],
	};
}

type Harness = {
	sent: WorkerToMainMessage[];
	core: ReturnType<typeof createWorkerCore>;
	loadCalls: string[];
	resolveLoad: (channelId: string, hasMore?: boolean) => void;
	rejectLoad: (channelId: string, error: unknown) => void;
};

function createHarness(
	options: {
		storedAt?: number;
		now?: () => number;
		staleAfterMs?: number;
		prefetchSpacingMs?: number;
		prefetchHourlyCap?: number;
		setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	} = {},
): Harness {
	const sent: WorkerToMainMessage[] = [];
	const loadCalls: string[] = [];
	const pendingLoads = new Map<string, (result: unknown) => void>();
	const cache = createHistoryCache({
		now: options.now ?? (() => 0),
	});
	if (options.storedAt !== undefined) {
		cache.set("ch1", {
			data: historyData("cached"),
			hasMore: true,
			storedAt: options.storedAt,
		});
	}
	const core = createWorkerCore({
		cache,
		queue: createLoadQueue(),
		load: (channelId) => {
			loadCalls.push(channelId);
			return new Promise((resolve, reject) => {
				pendingLoads.set(channelId, { resolve, reject } as never);
			}) as never;
		},
		send: (msg) => sent.push(msg),
		now: options.now ?? (() => 0),
		staleAfterMs: options.staleAfterMs,
		prefetchSpacingMs: options.prefetchSpacingMs,
		prefetchHourlyCap: options.prefetchHourlyCap,
		setTimer: options.setTimer,
	});
	const h: Harness = {
		sent,
		core,
		loadCalls,
		resolveLoad: (channelId, hasMore = false) => {
			(
				pendingLoads.get(channelId) as never as {
					resolve: (r: unknown) => void;
				}
			).resolve({ data: historyData(`fresh:${channelId}`), hasMore });
		},
		rejectLoad: (channelId, error) => {
			(
				pendingLoads.get(channelId) as never as {
					reject: (e: unknown) => void;
				}
			).reject(error);
		},
	};
	return h;
}

function flush(times = 4) {
	return new Promise((resolve) => setTimeout(resolve, 0 + times));
}

describe("createWorkerCore", () => {
	test("loads on cache miss, caches, and answers the request", async () => {
		const h = createHarness();

		h.core.handle({
			kind: "loadHistory",
			requestId: 7,
			channelId: "ch1",
			priority: "user",
		});
		await flush();

		expect(h.loadCalls).toEqual(["ch1"]);
		expect(h.sent).toHaveLength(0);

		h.resolveLoad("ch1", true);
		await flush();

		expect(h.sent).toEqual([
			{
				kind: "historyLoaded",
				requestId: 7,
				channelId: "ch1",
				data: historyData("fresh:ch1"),
				hasMore: true,
				fromCache: false,
			},
		]);

		// Cached now: a second load answers from cache without loading.
		h.sent.length = 0;
		h.core.handle({
			kind: "loadHistory",
			requestId: 8,
			channelId: "ch1",
			priority: "user",
		});
		await flush();

		expect(h.loadCalls).toEqual(["ch1"]);
		expect(h.sent).toEqual([
			{
				kind: "historyLoaded",
				requestId: 8,
				channelId: "ch1",
				data: historyData("fresh:ch1"),
				hasMore: true,
				fromCache: true,
			},
		]);
	});

	test("serves a stale entry immediately and refreshes in the background", async () => {
		// Cache TTL is 10 minutes; entries older than staleAfterMs (30s)
		// answer immediately but trigger a background refresh.
		const now = 120_000;
		const h = createHarness({ storedAt: 0, now: () => now });

		h.core.handle({
			kind: "loadHistory",
			requestId: 1,
			channelId: "ch1",
			priority: "user",
		});
		await flush();

		expect(h.sent[0]).toMatchObject({
			kind: "historyLoaded",
			requestId: 1,
			fromCache: true,
			data: historyData("cached"),
		});
		expect(h.loadCalls).toEqual(["ch1"]);

		h.resolveLoad("ch1");
		await flush();

		expect(h.sent[1]).toMatchObject({
			kind: "historyLoaded",
			requestId: 0,
			channelId: "ch1",
			fromCache: false,
			data: historyData("fresh:ch1"),
		});
	});

	test("fans one load out to concurrent requests for the same channel", async () => {
		const h = createHarness();

		h.core.handle({
			kind: "loadHistory",
			requestId: 1,
			channelId: "ch1",
			priority: "user",
		});
		h.core.handle({
			kind: "loadHistory",
			requestId: 2,
			channelId: "ch1",
			priority: "user",
		});
		await flush();

		expect(h.loadCalls).toEqual(["ch1"]);

		h.resolveLoad("ch1");
		await flush();

		expect(h.sent).toHaveLength(2);
		expect(
			h.sent.map((m) => (m.kind === "historyLoaded" ? m.requestId : -1)),
		).toEqual([1, 2]);
	});

	test("reports load failures with status", async () => {
		const h = createHarness();

		h.core.handle({
			kind: "loadHistory",
			requestId: 3,
			channelId: "ch1",
			priority: "user",
		});
		await flush();

		const error = Object.assign(new Error("forbidden"), { status: 403 });
		h.rejectLoad("ch1", error);
		await flush();

		expect(h.sent).toEqual([
			{
				kind: "historyError",
				requestId: 3,
				channelId: "ch1",
				message: "forbidden",
				status: 403,
			},
		]);
	});

	test("invalidate forces the next load to refetch", async () => {
		const h = createHarness();

		h.core.handle({
			kind: "loadHistory",
			requestId: 1,
			channelId: "ch1",
			priority: "user",
		});
		await flush();
		h.resolveLoad("ch1");
		await flush();
		expect(h.sent[0]).toMatchObject({
			kind: "historyLoaded",
			fromCache: false,
		});

		h.core.handle({ kind: "invalidate", channelId: "ch1" });
		h.sent.length = 0;
		h.core.handle({
			kind: "loadHistory",
			requestId: 2,
			channelId: "ch1",
			priority: "user",
		});
		await flush();

		expect(h.loadCalls).toEqual(["ch1", "ch1"]);
	});

	test("prefetches the predicted uncached channel and emits a warm-cache result", async () => {
		const h = createHarness({
			setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
		});
		h.core.handle({ kind: "recordVisit", channelId: "alpha", at: 0 });
		h.core.handle({ kind: "recordVisit", channelId: "beta", at: 1 });
		h.core.handle({ kind: "recordVisit", channelId: "alpha", at: 2 });
		h.core.handle({
			kind: "updateSignals",
			signals: {
				candidates: [
					{ channelId: "alpha", unread: false, mention: false, typing: false },
					{ channelId: "beta", unread: false, mention: false, typing: false },
					{ channelId: "gamma", unread: false, mention: false, typing: false },
				],
				currentChannelId: "alpha",
				currentUserId: "me",
				selectedChannelLoading: false,
				websocketConnected: true,
			},
		});
		await flush();

		expect(h.loadCalls).toEqual(["beta"]);
		expect(h.sent).toEqual([{ kind: "historyPrefetchQueued", channelId: "beta" }]);

		h.resolveLoad("beta", true);
		await flush();

		expect(h.sent[1]).toMatchObject({
			kind: "historyPrefetched",
			channelId: "beta",
			hasMore: true,
		});
	});

	test("enforces prefetch spacing before scheduling the next candidate", async () => {
		let currentTime = 0;
		const timers: (() => void)[] = [];
		const h = createHarness({
			now: () => currentTime,
			prefetchSpacingMs: 2_000,
			setTimer: (callback) => {
				timers.push(callback);
				return 0 as unknown as ReturnType<typeof setTimeout>;
			},
		});
		const signals = {
			candidates: [
				{ channelId: "alpha", unread: false, mention: false, typing: false },
				{ channelId: "beta", unread: true, mention: false, typing: false },
				{ channelId: "gamma", unread: false, mention: false, typing: false },
			],
			currentChannelId: "alpha",
			selectedChannelLoading: false,
			websocketConnected: true,
		};
		h.core.handle({ kind: "updateSignals", signals });
		await flush();
		h.resolveLoad("beta");
		await flush();

		currentTime = 1_999;
		timers.shift()?.();
		await flush();
		expect(h.loadCalls).toEqual(["beta"]);

		currentTime = 2_000;
		timers.shift()?.();
		await flush();
		expect(h.loadCalls).toEqual(["beta", "gamma"]);
	});

	test("enforces the hourly prefetch cap", async () => {
		let currentTime = 0;
		const timers: (() => void)[] = [];
		const h = createHarness({
			now: () => currentTime,
			prefetchHourlyCap: 1,
			setTimer: (callback) => {
				timers.push(callback);
				return 0 as unknown as ReturnType<typeof setTimeout>;
			},
		});
		h.core.handle({
			kind: "updateSignals",
			signals: {
				candidates: [
					{ channelId: "alpha", unread: false, mention: false, typing: false },
					{ channelId: "beta", unread: true, mention: false, typing: false },
					{ channelId: "gamma", unread: false, mention: false, typing: false },
				],
				currentChannelId: "alpha",
				selectedChannelLoading: false,
				websocketConnected: true,
			},
		});
		await flush();
		h.resolveLoad("beta");
		await flush();

		currentTime = 2_000;
		timers.shift()?.();
		await flush();
		expect(h.loadCalls).toEqual(["beta"]);
	});

	test("does not prefetch while disconnected or the selected history is loading", async () => {
		const h = createHarness();
		const candidates = [
			{ channelId: "alpha", unread: false, mention: false, typing: false },
			{ channelId: "beta", unread: true, mention: false, typing: false },
		];
		h.core.handle({
			kind: "updateSignals",
			signals: {
				candidates,
				currentChannelId: "alpha",
				selectedChannelLoading: false,
				websocketConnected: false,
			},
		});
		h.core.handle({
			kind: "updateSignals",
			signals: {
				candidates,
				currentChannelId: "alpha",
				selectedChannelLoading: true,
				websocketConnected: true,
			},
		});
		await flush();

		expect(h.loadCalls).toEqual([]);
	});
});
