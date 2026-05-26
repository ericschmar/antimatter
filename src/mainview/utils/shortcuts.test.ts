import { describe, expect, test } from "bun:test";
import { readShortcutAction } from "./shortcuts";

describe("readShortcutAction", () => {
	test("maps command search and settings shortcuts", () => {
		expect(readShortcutAction({ key: "k", metaKey: true })).toBe("command-menu");
		expect(readShortcutAction({ key: ",", metaKey: true })).toBe("settings");
	});

	test("maps section jump shortcuts", () => {
		expect(readShortcutAction({ key: "1", metaKey: true })).toBe("navigate-favorites");
		expect(readShortcutAction({ key: "2", metaKey: true })).toBe("navigate-channels");
		expect(readShortcutAction({ key: "3", metaKey: true })).toBe("navigate-dms");
	});

	test("maps channel, unread, and mention cycling shortcuts", () => {
		expect(readShortcutAction({ key: "[", metaKey: true })).toBe("navigate-prev-channel");
		expect(readShortcutAction({ key: "]", metaKey: true })).toBe("navigate-next-channel");
		expect(readShortcutAction({ key: "{", metaKey: true, shiftKey: true })).toBe("navigate-prev-unread");
		expect(readShortcutAction({ key: "}", metaKey: true, shiftKey: true })).toBe("navigate-next-unread");
		expect(readShortcutAction({ key: "[", altKey: true, metaKey: true })).toBe("navigate-prev-mention");
		expect(readShortcutAction({ key: "]", altKey: true, metaKey: true })).toBe("navigate-next-mention");
	});

	test("maps composer shortcuts", () => {
		expect(readShortcutAction({ key: "u", metaKey: true })).toBe("attach-file");
		expect(readShortcutAction({ key: "U", metaKey: true, shiftKey: true })).toBe("attach-image");
		expect(readShortcutAction({ key: "e", metaKey: true })).toBe("open-emoji-picker");
	});

	test("ignores unmodified keys", () => {
		expect(readShortcutAction({ key: "k" })).toBeNull();
	});
});
