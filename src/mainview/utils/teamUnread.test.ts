import { describe, expect, test } from "bun:test";
import { showTeamUnreadDot } from "./teamUnread";

describe("showTeamUnreadDot", () => {
	test("shows dot for a non-selected team with unread activity", () => {
		expect(showTeamUnreadDot({ b: true }, "b", "a")).toBe(true);
	});

	test("never shows the dot for the selected team", () => {
		expect(showTeamUnreadDot({ a: true }, "a", "a")).toBe(false);
	});

	test("does not show the dot when the team has no unread flag", () => {
		expect(showTeamUnreadDot({ b: false }, "b", "a")).toBe(false);
		expect(showTeamUnreadDot({}, "b", "a")).toBe(false);
	});
});
