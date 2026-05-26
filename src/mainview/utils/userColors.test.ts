import { describe, expect, test } from "bun:test";
import {
	colorForUserId,
	normalizeUserColor,
	USER_COLOR_PALETTE,
} from "./userColors";

describe("user color helpers", () => {
	test("normalizes hex color overrides", () => {
		expect(normalizeUserColor(" #AABBCC ")).toBe("#aabbcc");
		expect(normalizeUserColor("blue")).toBeNull();
		expect(normalizeUserColor("#abcd")).toBeNull();
	});

	test("assigns colors from the shared palette", () => {
		expect(USER_COLOR_PALETTE).toContain(colorForUserId("user-1"));
	});
});
