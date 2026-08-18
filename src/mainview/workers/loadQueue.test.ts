import { describe, expect, test } from "bun:test";
import { createLoadQueue } from "./loadQueue";

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function runLog(name: string, log: string[], gate?: Promise<void>) {
	return async () => {
		log.push(`start:${name}`);
		if (gate) await gate;
	};
}

describe("createLoadQueue", () => {
	test("runs immediately up to maxConcurrent and defers the rest", async () => {
		const log: string[] = [];
		const first = deferred();
		const second = deferred();
		const queue = createLoadQueue({ maxConcurrent: 2 });

		queue.add({
			channelId: "a",
			priority: "user",
			run: runLog("a", log, first.promise),
		});
		queue.add({
			channelId: "b",
			priority: "user",
			run: runLog("b", log, second.promise),
		});
		queue.add({ channelId: "c", priority: "user", run: runLog("c", log) });

		expect(log).toEqual(["start:a", "start:b"]);

		first.resolve();
		await new Promise((r) => setTimeout(r, 0));

		expect(log).toEqual(["start:a", "start:b", "start:c"]);
	});

	test("starts the highest priority task when a slot frees", async () => {
		const log: string[] = [];
		const gate = deferred();
		const queue = createLoadQueue({ maxConcurrent: 1 });

		queue.add({
			channelId: "a",
			priority: "user",
			run: runLog("a", log, gate.promise),
		});
		queue.add({ channelId: "p", priority: "prefetch", run: runLog("p", log) });
		queue.add({ channelId: "s", priority: "startup", run: runLog("s", log) });
		queue.add({ channelId: "u", priority: "user", run: runLog("u", log) });

		gate.resolve();
		await new Promise((r) => setTimeout(r, 0));

		expect(log).toEqual(["start:a", "start:u", "start:s", "start:p"]);
	});

	test("dedupes a queued task for the same channel, keeping the higher priority", async () => {
		const log: string[] = [];
		const queue = createLoadQueue({ maxConcurrent: 1 });
		const gate = deferred();
		const runs: string[] = [];

		queue.add({
			channelId: "a",
			priority: "user",
			run: runLog("a", log, gate.promise),
		});
		queue.add({
			channelId: "b",
			priority: "prefetch",
			run: () => {
				runs.push("prefetch");
			},
		});
		queue.add({
			channelId: "b",
			priority: "user",
			run: () => {
				runs.push("user");
			},
		});

		gate.resolve();
		await new Promise((r) => setTimeout(r, 0));

		expect(runs).toEqual(["user"]);
	});

	test("drops a task for a channel that is already running", async () => {
		const runs: string[] = [];
		const gate = deferred();
		const queue = createLoadQueue({ maxConcurrent: 1 });

		queue.add({
			channelId: "a",
			priority: "user",
			run: async () => {
				await gate.promise;
				runs.push("first");
			},
		});
		queue.add({
			channelId: "a",
			priority: "user",
			run: async () => {
				runs.push("second");
			},
		});

		gate.resolve();
		await new Promise((r) => setTimeout(r, 10));

		expect(runs).toEqual(["first"]);
	});
});
