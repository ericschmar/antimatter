import type { MattermostRpcResponse } from "../../shared/electrobunRpc";
import { type MattermostApiClient, MattermostApiError } from "../mattermostApi";
import type { ChannelHistoryData } from "../types";
import { traceEvent } from "../utils/perfTrace";
import type {
	HistoryPrefetchSignals,
	HistoryPriority,
	MainToWorkerMessage,
	WorkerToMainMessage,
} from "./chatHistoryProtocol";
import {
	type HistoryWaterfallResult,
	loadChannelHistoryWaterfall,
} from "./historyWaterfall";

type BrokerCall = {
	path: string;
	method?: "GET" | "POST" | "PUT" | "DELETE";
	body?: unknown;
};

export type ChatHistoryClient = {
	loadChannelHistory: (
		channelId: string,
		currentUserId?: string,
		priority?: HistoryPriority,
	) => Promise<HistoryWaterfallResult>;
	invalidate: (channelId: string) => void;
	recordVisit: (channelId: string, at: number) => void;
	updateSignals: (signals: HistoryPrefetchSignals) => void;
	reset: () => void;
	onBackgroundHistory?: (
		channelId: string,
		data: ChannelHistoryData,
		hasMore: boolean,
	) => void;
};

/**
 * Fetches the prebuilt worker bundle and spawns it as a blob-URL classic
 * worker. WKWebView does not load workers from the app's views:// scheme
 * directly, and Bun.build does not resolve `new Worker(new URL(...))`
 * module references, so the script is fetched and wrapped in a blob.
 *
 * The views scheme maps `views://<view>/<file>` to app views/<view>/<file>,
 * so the worker is addressed as its own "host" — a path-relative URL would
 * resolve under the mainview host and 404.
 */
async function createBlobWorker(): Promise<Worker> {
	const scriptUrl = `${location.protocol}//chatHistoryWorker/chatHistoryWorker.js`;
	const response = await fetch(scriptUrl);
	if (!response.ok) {
		throw new Error(`chat history worker fetch failed: ${response.status}`);
	}
	const source = await response.text();
	const blobUrl = URL.createObjectURL(
		new Blob([source], { type: "text/javascript" }),
	);
	return new Worker(blobUrl);
}

export function createChatHistoryClient(deps: {
	api: MattermostApiClient;
	broker: (call: BrokerCall) => Promise<MattermostRpcResponse>;
	createWorker?: () => Promise<Worker>;
	handshakeTimeoutMs?: number;
	log?: (message: string) => void;
}): ChatHistoryClient {
	const createWorker = deps.createWorker ?? createBlobWorker;
	const handshakeTimeoutMs = deps.handshakeTimeoutMs ?? 5_000;
	const logWorkerStatus =
		deps.log ??
		((message: string) => console.log("chat-history-worker:", message));

	let worker: Worker | null = null;
	let workerPromise: Promise<Worker | null> | null = null;
	let workerUsable = false;
	let workerProven = false;
	let nextRequestId = 1;
	const pendingLoads = new Map<
		number,
		{
			channelId: string;
			resolve: (result: HistoryWaterfallResult) => void;
			reject: (error: Error) => void;
		}
	>();

	function fallback(
		channelId: string,
		currentUserId?: string,
	): Promise<HistoryWaterfallResult> {
		return loadChannelHistoryWaterfall(deps.api, channelId, currentUserId);
	}

	function retireWorker(reason: string): void {
		if (worker) worker.terminate();
		worker = null;
		workerPromise = null;
		workerUsable = false;
		workerProven = false;
		for (const pending of pendingLoads.values()) {
			pending.reject(new Error(`${reason}: chat history load aborted`));
		}
		pendingLoads.clear();
	}

	function handleWorkerMessage(message: WorkerToMainMessage): void {
		if (message.kind === "rpcCall") {
			void deps
				.broker({
					path: message.path,
					method: message.method,
					body: message.body,
				})
				.then((response) => {
					worker?.postMessage({
						kind: "rpcResult",
						requestId: message.requestId,
						ok: response.ok,
						status: response.status,
						body: response.body,
					} satisfies MainToWorkerMessage);
				})
				.catch((error: unknown) => {
					worker?.postMessage({
						kind: "rpcResult",
						requestId: message.requestId,
						ok: false,
						message: error instanceof Error ? error.message : String(error),
					} satisfies MainToWorkerMessage);
				});
			return;
		}
		if (message.kind === "historyPrefetchQueued") {
			traceEvent("prefetchQueued");
			return;
		}
		if (message.kind === "historyPrefetched") {
			traceEvent("prefetchLoaded");
			client.onBackgroundHistory?.(
				message.channelId,
				message.data,
				message.hasMore,
			);
			return;
		}
		if (message.kind === "historyLoaded") {
			if (message.fromCache) traceEvent("cacheHit");
			if (message.requestId === 0) {
				client.onBackgroundHistory?.(
					message.channelId,
					message.data,
					message.hasMore,
				);
				return;
			}
			const pending = pendingLoads.get(message.requestId);
			if (!pending) return;
			pendingLoads.delete(message.requestId);
			workerProven = true;
			pending.resolve({
				data: message.data,
				hasMore: message.hasMore,
			});
			return;
		}
		const pending = pendingLoads.get(message.requestId);
		if (!pending) return;
		pendingLoads.delete(message.requestId);
		pending.reject(
			new MattermostApiError(message.status ?? 0, message.message),
		);
	}

	async function ensureWorker(): Promise<Worker | null> {
		if (!workerUsable && worker) return worker;
		if (workerPromise) return workerPromise;
		workerPromise = createWorker()
			.then((created) => {
				worker = created;
				workerUsable = true;
				created.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
					handleWorkerMessage(event.data);
				};
				created.onerror = () => {
					retireWorker("worker crashed");
				};
				void logWorkerStatus("worker spawned");
				return created;
			})
			.catch((error: unknown) => {
				workerPromise = null;
				workerUsable = false;
				void logWorkerStatus(
					`worker unavailable, falling back to main thread: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				return null;
			});
		return workerPromise;
	}

	const client: ChatHistoryClient = {
		async loadChannelHistory(channelId, currentUserId, priority = "user") {
			traceEvent("historyFetchStart");
			const created = await ensureWorker();
			if (!created)
				return fallback(channelId, currentUserId).finally(() =>
					traceEvent("historyFetchEnd"),
				);

			const requestId = nextRequestId;
			nextRequestId += 1;
			const request = new Promise<HistoryWaterfallResult>((resolve, reject) => {
				pendingLoads.set(requestId, { channelId, resolve, reject });
			});
			created.postMessage({
				kind: "loadHistory",
				requestId,
				channelId,
				currentUserId,
				priority,
			} satisfies MainToWorkerMessage);

			if (!workerProven) {
				// Handshake guard: if the worker never answers its first load,
				// retire it and answer on the main thread.
				const loser = await Promise.race([
					request.then(() => "answered" as const),
					new Promise<"timeout">((resolve) =>
						setTimeout(() => resolve("timeout"), handshakeTimeoutMs),
					),
				]);
				if (loser === "timeout") {
					pendingLoads.delete(requestId);
					retireWorker("worker handshake timed out");
					return fallback(channelId, currentUserId).finally(() =>
						traceEvent("historyFetchEnd"),
					);
				}
			}
			return request.finally(() => traceEvent("historyFetchEnd"));
		},

		invalidate(channelId) {
			worker?.postMessage({
				kind: "invalidate",
				channelId,
			} satisfies MainToWorkerMessage);
		},

		recordVisit(channelId, at) {
			worker?.postMessage({
				kind: "recordVisit",
				channelId,
				at,
			} satisfies MainToWorkerMessage);
		},

		updateSignals(signals) {
			worker?.postMessage({
				kind: "updateSignals",
				signals,
			} satisfies MainToWorkerMessage);
		},

		reset() {
			retireWorker("worker reset");
		},
	};

	return client;
}

// Active-session registry so the six MainViewApp call sites and the
// websocket post handler can reach the client without prop drilling.

let activeClient: ChatHistoryClient | null = null;

export function setActiveChatHistoryClient(client: ChatHistoryClient | null) {
	if (activeClient) activeClient.reset();
	activeClient = client;
}

export function getActiveChatHistoryClient(): ChatHistoryClient | null {
	return activeClient;
}

export function invalidateActiveChatHistoryClient(channelId: string): void {
	activeClient?.invalidate(channelId);
}
