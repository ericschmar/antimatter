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

	test("uses the configured username color palette", () => {
		expect(USER_COLOR_PALETTE).toEqual([
			"#151829",
			"#252c45",
			"#3c4b6b",
			"#596e8f",
			"#7293a6",
			"#95bac2",
			"#0b2566",
			"#12498c",
			"#1c7199",
			"#319fb0",
			"#86d9d5",
			"#0d323b",
			"#114d44",
			"#127a3e",
			"#5ab03f",
			"#b5d96c",
			"#590c25",
			"#9c2219",
			"#bd622a",
			"#e6ba39",
			"#eddc6b",
			"#300633",
			"#61135a",
			"#8f2b76",
			"#b04d8a",
			"#d17997",
			"#e0a2ad",
			"#732816",
			"#964a2c",
			"#ba7947",
			"#d9b484",
			"#fffece",
		]);
	});

	test("assigns colors from the shared palette", () => {
		expect(USER_COLOR_PALETTE).toContain(colorForUserId("user-1"));
	});
});
