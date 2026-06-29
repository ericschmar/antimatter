import { describe, expect, test } from "bun:test";
import { buildMentionInsertion, matchMentionQuery } from "./MessageComposer";

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

describe("buildMentionInsertion", () => {
	test("places the cursor after the inserted mention", () => {
		expect(
			buildMentionInsertion("hey @sar", { query: "sar", start: 4 }, "sarah"),
		).toEqual({ message: "hey @sarah ", cursorPosition: 11 });
	});
});
