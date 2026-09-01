import type { ChannelHistoryData } from "../types";

export type HistoryPriority = "user" | "startup" | "prefetch";

export const HISTORY_PRIORITY_ORDER: Record<HistoryPriority, number> = {
	user: 0,
	startup: 1,
	prefetch: 2,
};

export type HistoryPrefetchCandidate = {
	channelId: string;
	unread: boolean;
	mention: boolean;
	typing: boolean;
};

export type HistoryPrefetchSignals = {
	candidates: HistoryPrefetchCandidate[];
	currentChannelId?: string;
	currentUserId?: string;
	selectedChannelLoading: boolean;
	websocketConnected: boolean;
};

export type HistoryRpcCall = {
	kind: "rpcCall";
	requestId: number;
	path: string;
	method?: "GET" | "POST" | "PUT" | "DELETE";
	body?: unknown;
};

export type HistoryRpcResult =
	| {
			kind: "rpcResult";
			requestId: number;
			ok: true;
			status: number;
			body: unknown;
	  }
	| {
			kind: "rpcResult";
			requestId: number;
			ok: false;
			// status+body = an HTTP-level error response; the worker-side
			// MattermostApiClient turns it into a MattermostApiError. A
			// message-only result means the RPC itself failed.
			status?: number;
			body?: unknown;
			message?: string;
	  };

export type MainToWorkerMessage =
	| {
			kind: "loadHistory";
			requestId: number;
			channelId: string;
			currentUserId?: string;
			priority: HistoryPriority;
	  }
	| { kind: "invalidate"; channelId: string }
	| { kind: "recordVisit"; channelId: string; at: number }
	| { kind: "updateSignals"; signals: HistoryPrefetchSignals }
	| HistoryRpcResult;

export type WorkerToMainMessage =
	| HistoryRpcCall
	| {
			kind: "historyLoaded";
			requestId: number;
			channelId: string;
			data: ChannelHistoryData;
			hasMore: boolean;
			fromCache: boolean;
	  }
	| {
			kind: "historyError";
			requestId: number;
			channelId: string;
			message: string;
			status?: number;
	  }
	| {
			kind: "historyPrefetchQueued";
			channelId: string;
	  }
	| {
			kind: "historyPrefetched";
			channelId: string;
			data: ChannelHistoryData;
			hasMore: boolean;
	  }
| {
			kind: "historyMembersLoaded";
			channelId: string;
			memberUsers: ChannelHistoryData["memberUsers"];
			members: ChannelHistoryData["members"];
	  };
