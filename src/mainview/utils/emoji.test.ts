import { describe, expect, test } from "bun:test";
import { emojiNameToGlyph, normalizeEmojiName } from "./emoji";

describe("emoji helpers", () => {
	test("normalizes Mattermost reaction aliases to Emoji Mart ids", () => {
		expect(normalizeEmojiName("thumbsup")).toBe("+1");
		expect(normalizeEmojiName("thumbs-up")).toBe("+1");
		expect(normalizeEmojiName(":-1:")).toBe("-1");
	});

	test("renders known reaction names as native emoji", () => {
		expect(emojiNameToGlyph("+1")).toBe("👍");
		expect(emojiNameToGlyph("-1")).toBe("👎");
		expect(emojiNameToGlyph("thumbsup")).toBe("👍");
	});
});
