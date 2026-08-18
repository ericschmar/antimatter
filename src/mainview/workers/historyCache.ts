import type { ChannelHistoryData } from "../types";

export type HistoryCacheEntry = {
	data: ChannelHistoryData;
	hasMore: boolean;
	storedAt: number;
};

export type HistoryCache = {
	get: (channelId: string) => HistoryCacheEntry | null;
	set: (channelId: string, entry: HistoryCacheEntry) => void;
	delete: (channelId: string) => void;
	clear: () => void;
	size: () => number;
};

export function createHistoryCache(
	options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {},
): HistoryCache {
	const maxEntries = options.maxEntries ?? 20;
	const ttlMs = options.ttlMs ?? 10 * 60_000;
	const now = options.now ?? (() => Date.now());
	const entries = new Map<string, HistoryCacheEntry>();

	function get(channelId: string): HistoryCacheEntry | null {
		const entry = entries.get(channelId);
		if (!entry) return null;
		if (now() - entry.storedAt > ttlMs) {
			entries.delete(channelId);
			return null;
		}
		// Re-insert so Map insertion order tracks recency for LRU eviction.
		entries.delete(channelId);
		entries.set(channelId, entry);
		return entry;
	}

	function set(channelId: string, entry: HistoryCacheEntry): void {
		entries.delete(channelId);
		entries.set(channelId, entry);
		while (entries.size > maxEntries) {
			const oldest = entries.keys().next();
			if (oldest.done) break;
			entries.delete(oldest.value);
		}
	}

	return {
		get,
		set,
		delete: (channelId) => entries.delete(channelId),
		clear: () => entries.clear(),
		size: () => entries.size,
	};
}
