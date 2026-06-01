import { describe, expect, test } from "bun:test";
import { matchMentionQuery } from "./MessageComposer";

describe("matchMentionQuery", () => {
	test("matches an empty mention query after @", () => {
		expect(matchMentionQuery("@")).toEqual({ query: "", start: 0 });
	});

	test("matches the query text being typed after @", () => {
		expect(matchMentionQuery("hey @sar")).toEqual({ query: "sar", start: 4 });
	});

	test("allows editor-normalized trailing newlines", () => {
		expect(matchMentionQuery("@sar\n\n")).toEqual({ query: "sar", start: 0 });
	});

	test("does not match once a typed space completes the mention", () => {
		expect(matchMentionQuery("@sar ")).toBeNull();
	});
});
