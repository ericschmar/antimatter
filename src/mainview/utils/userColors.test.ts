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
			"#0d0305",
			"#3c3444",
			"#6e576e",
			"#917d9b",
			"#c5b7cb",
			"#f7f4e8",
			"#5f4f47",
			"#851246",
			"#d72048",
			"#7d322f",
			"#9d4c2f",
			"#c65e2d",
			"#f96a2d",
			"#ffa300",
			"#e29138",
			"#f7c233",
			"#f9ec41",
			"#11442c",
			"#287a33",
			"#52b139",
			"#8ae931",
			"#0e131e",
			"#203c62",
			"#2a69b0",
			"#00a1de",
			"#6bdad5",
			"#a52eb8",
			"#f7406e",
			"#fc83a2",
			"#f9cf9d",
			"#fba176",
			"#f66f67",
		]);
	});

	test("assigns colors from the shared palette", () => {
		expect(USER_COLOR_PALETTE).toContain(colorForUserId("user-1"));
	});
});
