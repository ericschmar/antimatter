import { describe, expect, test } from "bun:test";
import type { MattermostApiClient } from "../mattermostApi";
import { createReactionScheduler } from "./reactionScheduler";

describe("createReactionScheduler", () => {
	test("deduplicates post requests, caps concurrency, and discards old channels", async () => {
		let active = 0;
		let maximum = 0;
		const releases: Array<() => void> = [];
		const applied: string[] = [];
		const api = {
			getReactionsForPost: (postId: string) =>
				new Promise((resolve) => {
					active += 1;
					maximum = Math.max(maximum, active);
					releases.push(() => {
						active -= 1;
						resolve([{ post_id: postId, user_id: "u1", emoji_name: "eyes" }]);
					});
				}),
		} as unknown as MattermostApiClient;
		const scheduler = createReactionScheduler({
			api,
			maxConcurrent: 2,
			apply: (items) => applied.push(...items.map((item) => item.postId)),
		});

		scheduler.setActiveChannel("one");
		scheduler.schedule("one", ["p1", "p1", "p2", "p3"]);
		await Promise.resolve();
		expect(maximum).toBe(2);
		scheduler.setActiveChannel("two");
		for (const release of releases.splice(0)) release();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(applied).toEqual([]);
	});
});
