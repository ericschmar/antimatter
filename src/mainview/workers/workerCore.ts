import type {
	HistoryPrefetchSignals,
	MainToWorkerMessage,
	WorkerToMainMessage,
} from "./chatHistoryProtocol";
import {
	createHistoryPrefetchPredictor,
	type HistoryPrefetchPredictor,
} from "./historyPrefetchPredictor";
import type { HistoryCache } from "./historyCache";
import type { HistoryWaterfallResult } from "./historyWaterfall";
import type { LoadQueue } from "./loadQueue";

export type WorkerCore = {
	handle: (message: MainToWorkerMessage) => void;
};

const BACKGROUND_REFRESH_REQUEST_ID = 0;
const PREFETCH_SPACING_MS = 2_000;
const PREFETCH_HOURLY_CAP = 20;

type Timer = ReturnType<typeof setTimeout>;

export function createWorkerCore(deps: {
	cache: HistoryCache;
	queue: LoadQueue;
	load: (
		channelId: string,
		currentUserId?: string,
	) => Promise<HistoryWaterfallResult>;
	send: (message: WorkerToMainMessage) => void;
	now?: () => number;
	staleAfterMs?: number;
	predictor?: HistoryPrefetchPredictor;
	prefetchSpacingMs?: number;
	prefetchHourlyCap?: number;
	setTimer?: (callback: () => void, delay: number) => Timer;
	clearTimer?: (timer: Timer) => void;
}): WorkerCore {
	const now = deps.now ?? (() => Date.now());
	const staleAfterMs = deps.staleAfterMs ?? 30_000;
	const predictor = deps.predictor ?? createHistoryPrefetchPredictor();
	const prefetchSpacingMs = deps.prefetchSpacingMs ?? PREFETCH_SPACING_MS;
	const prefetchHourlyCap = deps.prefetchHourlyCap ?? PREFETCH_HOURLY_CAP;
	const setTimer = deps.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
	const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer));
	const pendingRequests = new Map<string, number[]>();
	const pendingCurrentUser = new Map<string, string | undefined>();
	const activeChannels = new Set<string>();
	const prefetchStarts: number[] = [];
	let latestSignals: HistoryPrefetchSignals | null = null;
	let prefetchInFlight = false;
	let lastPrefetchAt = Number.NEGATIVE_INFINITY;
	let prefetchTimer: Timer | undefined;

	function clearPrefetchTimer(): void {
		if (!prefetchTimer) return;
		clearTimer(prefetchTimer);
		prefetchTimer = undefined;
	}

	function respondLoaded(
		channelId: string,
		requestIds: number[],
		data: HistoryWaterfallResult,
		fromCache: boolean,
	): void {
		for (const requestId of requestIds) {
			deps.send({
				kind: "historyLoaded",
				requestId,
				channelId,
				data: data.data,
				hasMore: data.hasMore,
				fromCache,
			});
		}
	}

	function schedulePrefetch(): void {
		const signals = latestSignals;
		if (
			!signals ||
			!signals.currentChannelId ||
			!signals.websocketConnected ||
			signals.selectedChannelLoading ||
			prefetchInFlight
		) {
			clearPrefetchTimer();
			return;
		}

		const currentTime = now();
		while (
			prefetchStarts.length > 0 &&
			prefetchStarts[0] <= currentTime - 60 * 60_000
		) {
			prefetchStarts.shift();
		}
		if (prefetchStarts.length >= prefetchHourlyCap) return;

		const delay = Math.max(0, lastPrefetchAt + prefetchSpacingMs - currentTime);
		if (delay > 0) {
			if (prefetchTimer) return;
			prefetchTimer = setTimer(() => {
				prefetchTimer = undefined;
				schedulePrefetch();
			}, delay);
			return;
		}

		const nextChannelId = predictor
			.rank(signals.currentChannelId, signals.candidates, currentTime)
			.find(
				(channelId) =>
					!activeChannels.has(channelId) && !deps.cache.get(channelId),
			);
		if (!nextChannelId) return;

		prefetchInFlight = true;
		lastPrefetchAt = currentTime;
		prefetchStarts.push(currentTime);
		pendingRequests.set(nextChannelId, []);
		pendingCurrentUser.set(nextChannelId, signals.currentUserId);
		deps.send({ kind: "historyPrefetchQueued", channelId: nextChannelId });
		startLoad(nextChannelId, "prefetch", true);
	}

	function startLoad(
		channelId: string,
		priority: "user" | "startup" | "prefetch",
		isPrefetch = false,
	): void {
		activeChannels.add(channelId);
		deps.queue.add({
			channelId,
			priority,
			run: async () => {
				const requestIds = pendingRequests.get(channelId) ?? [];
				let result: HistoryWaterfallResult | undefined;
				let error: (Error & { status?: number }) | undefined;
				try {
					result = await deps.load(channelId, pendingCurrentUser.get(channelId));
				} catch (caught) {
					error = caught as Error & { status?: number };
				} finally {
					pendingRequests.delete(channelId);
					pendingCurrentUser.delete(channelId);
					activeChannels.delete(channelId);
					if (isPrefetch) prefetchInFlight = false;
				}

				if (!result) {
					for (const requestId of requestIds) {
						if (requestId === BACKGROUND_REFRESH_REQUEST_ID) continue;
						deps.send({
							kind: "historyError",
							requestId,
							channelId,
							message: error?.message ?? "Could not load channel history.",
							status: error?.status,
						});
					}
					schedulePrefetch();
					return;
				}

				deps.cache.set(channelId, {
					data: result.data,
					hasMore: result.hasMore,
					storedAt: now(),
				});
				if (isPrefetch) {
					deps.send({
						kind: "historyPrefetched",
						channelId,
						data: result.data,
						hasMore: result.hasMore,
					});
				}
				respondLoaded(channelId, requestIds, result, false);
				schedulePrefetch();
			},
		});
	}

	return {
		handle(message) {
			if (message.kind === "invalidate") {
				deps.cache.delete(message.channelId);
				return;
			}
			if (message.kind === "recordVisit") {
				predictor.recordVisit(message.channelId, message.at);
				schedulePrefetch();
				return;
			}
			if (message.kind === "updateSignals") {
				latestSignals = message.signals;
				schedulePrefetch();
				return;
			}
			if (message.kind === "rpcResult") return;

			const { channelId, requestId } = message;
			pendingCurrentUser.set(channelId, message.currentUserId);

			const cached = deps.cache.get(channelId);
			if (cached) {
				deps.send({
					kind: "historyLoaded",
					requestId,
					channelId,
					data: cached.data,
					hasMore: cached.hasMore,
					fromCache: true,
				});
				const age = now() - cached.storedAt;
				if (age > staleAfterMs) {
					pendingRequests.set(channelId, [BACKGROUND_REFRESH_REQUEST_ID]);
					startLoad(channelId, "prefetch");
				}
				return;
			}

			const pending = pendingRequests.get(channelId);
			if (pending && activeChannels.has(channelId)) {
				pending.push(requestId);
				return;
			}
			pendingRequests.set(channelId, [requestId]);
			startLoad(channelId, message.priority);
		},
	};
}
