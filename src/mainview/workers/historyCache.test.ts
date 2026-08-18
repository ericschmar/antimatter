import { describe, expect, test } from "bun:test";
import type { ChannelHistoryData } from "../types";
import { createHistoryCache } from "./historyCache";

function entryData(seed: string): ChannelHistoryData {
	return {
		memberUsers: [],
		members: [],
		postOrder: [seed],
		posts: {},
		postUsers: [],
	};
}

describe("createHistoryCache", () => {
	test("stores and returns entries", () => {
		const cache = createHistoryCache({ now: () => 0 });
		cache.set("ch1", { data: entryData("p1"), hasMore: false, storedAt: 0 });

		expect(cache.get("ch1")?.data.postOrder).toEqual(["p1"]);
		expect(cache.get("ch1")?.hasMore).toBe(false);
	});

	test("returns null for missing entries", () => {
		const cache = createHistoryCache({ now: () => 0 });

		expect(cache.get("nope")).toBeNull();
	});

	test("expires entries past ttl and prunes them", () => {
		let now = 0;
		const cache = createHistoryCache({ ttlMs: 1000, now: () => now });
		cache.set("ch1", { data: entryData("p1"), hasMore: false, storedAt: 0 });

		now = 999;
		expect(cache.get("ch1")).not.toBeNull();

		now = 1001;
		expect(cache.get("ch1")).toBeNull();
		expect(cache.size()).toBe(0);
	});

	test("evicts least recently used entries beyond maxEntries", () => {
		const cache = createHistoryCache({ maxEntries: 2, now: () => 0 });
		cache.set("a", { data: entryData("a"), hasMore: false, storedAt: 0 });
		cache.set("b", { data: entryData("b"), hasMore: false, storedAt: 0 });
		cache.get("a");
		cache.set("c", { data: entryData("c"), hasMore: false, storedAt: 0 });

		expect(cache.get("a")).not.toBeNull();
		expect(cache.get("b")).toBeNull();
		expect(cache.get("c")).not.toBeNull();
		expect(cache.size()).toBe(2);
	});

	test("delete removes a single entry", () => {
		const cache = createHistoryCache({ now: () => 0 });
		cache.set("a", { data: entryData("a"), hasMore: false, storedAt: 0 });
		cache.set("b", { data: entryData("b"), hasMore: false, storedAt: 0 });

		cache.delete("a");

		expect(cache.get("a")).toBeNull();
		expect(cache.get("b")).not.toBeNull();
	});

	test("clear removes every entry", () => {
		const cache = createHistoryCache({ now: () => 0 });
		cache.set("a", { data: entryData("a"), hasMore: false, storedAt: 0 });

		cache.clear();

		expect(cache.size()).toBe(0);
		expect(cache.get("a")).toBeNull();
	});
});
