import { describe, expect, test } from "bun:test";
import { createHistoryPrefetchPredictor } from "./historyPrefetchPredictor";

const atNine = new Date(2026, 7, 18, 9).getTime();

const candidates = [
	{ channelId: "alpha", unread: false, mention: false, typing: false },
	{ channelId: "beta", unread: false, mention: false, typing: false },
	{ channelId: "gamma", unread: false, mention: false, typing: false },
];

describe("createHistoryPrefetchPredictor", () => {
	test("ranks the most likely Markov transitions first", () => {
		const predictor = createHistoryPrefetchPredictor();
		predictor.recordVisit("alpha", atNine);
		predictor.recordVisit("beta", atNine);
		predictor.recordVisit("alpha", atNine);
		predictor.recordVisit("beta", atNine);
		predictor.recordVisit("alpha", atNine);
		predictor.recordVisit("gamma", atNine);

		expect(predictor.rank("alpha", candidates, atNine)).toEqual([
			"beta",
			"gamma",
		]);
	});

	test("ranks mention, unread, typing, and time-of-day signals", () => {
		const predictor = createHistoryPrefetchPredictor();
		predictor.recordVisit("beta", atNine);
		predictor.recordVisit("alpha", atNine);
		predictor.recordVisit("beta", atNine);
		predictor.recordVisit("alpha", atNine);

		expect(
			predictor.rank(
				"alpha",
				[
					{ channelId: "alpha", unread: false, mention: false, typing: false },
					{ channelId: "beta", unread: false, mention: false, typing: false },
					{ channelId: "gamma", unread: true, mention: true, typing: true },
				],
				atNine,
			),
		).toEqual(["gamma", "beta"]);
	});

	test("excludes the current channel and resolves equal scores by channel id", () => {
		const predictor = createHistoryPrefetchPredictor();

		expect(predictor.rank("alpha", candidates, atNine)).toEqual([
			"beta",
			"gamma",
		]);
	});
});
