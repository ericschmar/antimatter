import type {
	MainToWorkerMessage,
	WorkerToMainMessage,
} from "./chatHistoryProtocol";
import type { HistoryCache } from "./historyCache";
import type { HistoryWaterfallResult } from "./historyWaterfall";
import type { LoadQueue } from "./loadQueue";

export type WorkerCore = {
	handle: (message: MainToWorkerMessage) => void;
};

const BACKGROUND_REFRESH_REQUEST_ID = 0;

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
}): WorkerCore {
	const now = deps.now ?? (() => Date.now());
	const staleAfterMs = deps.staleAfterMs ?? 30_000;
	// Requests waiting on an active (queued or running) load for a channel.
	const pendingRequests = new Map<string, number[]>();
	// currentUserId of the most recent requester, used for the load call.
	const pendingCurrentUser = new Map<string, string | undefined>();
	const activeChannels = new Set<string>();

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

	function startLoad(
		channelId: string,
		priority: "user" | "startup" | "prefetch",
	): void {
		activeChannels.add(channelId);
		deps.queue.add({
			channelId,
			priority,
			run: async () => {
				const requestIds = pendingRequests.get(channelId) ?? [];
				let result: HistoryWaterfallResult;
				try {
					result = await deps.load(
						channelId,
						pendingCurrentUser.get(channelId),
					);
				} catch (error) {
					const err = error as Error & { status?: number };
					// Background refreshes have no requester to disappoint.
					for (const requestId of requestIds) {
						if (requestId === BACKGROUND_REFRESH_REQUEST_ID) continue;
						deps.send({
							kind: "historyError",
							requestId,
							channelId,
							message: err.message,
							status: err.status,
						});
					}
					return;
				} finally {
					pendingRequests.delete(channelId);
					pendingCurrentUser.delete(channelId);
					activeChannels.delete(channelId);
				}
				deps.cache.set(channelId, {
					data: result.data,
					hasMore: result.hasMore,
					storedAt: now(),
				});
				respondLoaded(channelId, requestIds, result, false);
			},
		});
	}

	return {
		handle(message) {
			if (message.kind === "invalidate") {
				deps.cache.delete(message.channelId);
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
					// Serve instantly, then catch up in the background.
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
