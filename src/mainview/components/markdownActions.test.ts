import { describe, expect, test } from "bun:test";
import { insertLink, toggleLinePrefix, wrapSelection } from "./markdownActions";

describe("wrapSelection", () => {
	test("inserts empty markers and places the caret between them when nothing is selected", () => {
		expect(wrapSelection("hello", { start: 5, end: 5 }, "**", "**")).toEqual({
			message: "hello****",
			selection: { start: 7, end: 7 },
		});
	});

	test("wraps the selected text and keeps it selected", () => {
		expect(
			wrapSelection("hello world", { start: 6, end: 11 }, "**", "**"),
		).toEqual({
			message: "hello **world**",
			selection: { start: 8, end: 13 },
		});
	});

	test("supports multiline code-block markers", () => {
		const result = wrapSelection(
			"code",
			{ start: 0, end: 4 },
			"\n```\n",
			"\n```\n",
		);
		expect(result.message).toBe("\n```\ncode\n```\n");
		expect(result.selection).toEqual({ start: 5, end: 9 });
	});
});

describe("toggleLinePrefix", () => {
	test("adds the prefix to the current line", () => {
		expect(
			toggleLinePrefix("hello world", { start: 6, end: 6 }, "- ").message,
		).toBe("- hello world");
	});

	test("removes an existing prefix (toggle off)", () => {
		expect(
			toggleLinePrefix("- hello", { start: 4, end: 4 }, "- ").message,
		).toBe("hello");
	});

	test("only affects the line the caret is on", () => {
		expect(
			toggleLinePrefix("first\nsecond\nthird", { start: 7, end: 7 }, "> ")
				.message,
		).toBe("first\n> second\nthird");
	});

	test("works on the first line", () => {
		expect(toggleLinePrefix("hello", { start: 0, end: 0 }, "# ").message).toBe(
			"# hello",
		);
	});
});

describe("insertLink", () => {
	test("inserts a link with the url placeholder selected when nothing is selected", () => {
		const result = insertLink("hello ", { start: 6, end: 6 });
		expect(result.message).toBe("hello [text](url)");
		expect(result.selection).toEqual({ start: 13, end: 16 });
	});

	test("uses the selection as the link text", () => {
		const result = insertLink("click here", { start: 6, end: 10 });
		expect(result.message).toBe("click [here](url)");
		expect(result.selection).toEqual({ start: 13, end: 16 });
	});
});
