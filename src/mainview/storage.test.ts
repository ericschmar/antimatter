import { afterEach, describe, expect, test } from "bun:test";
import {
	loadArchivedChannelIds,
	loadChannelEmojis,
	loadChannelOrder,
	loadUserColorPaletteVersion,
	loadUserColors,
	saveArchivedChannelIds,
	saveChannelEmojis,
	saveChannelOrder,
	saveUserColorPaletteVersion,
	saveUserColors,
} from "./storage";

const originalLocalStorage = globalThis.localStorage;

class MemoryStorage implements Storage {
	private values = new Map<string, string>();
	get length() {
		return this.values.size;
	}
	clear() {
		this.values.clear();
	}
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	key(index: number) {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

describe("storage helpers", () => {
	afterEach(() => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: originalLocalStorage,
		});
	});

	test("round-trips channel emoji overrides", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		saveChannelEmojis({ "channel-1": "🚀" });
		expect(loadChannelEmojis()).toEqual({ "channel-1": "🚀" });
	});

	test("round-trips channel order", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		saveChannelOrder({ channels: ["a", "b"], dms: ["c"], favorites: [] });
		expect(loadChannelOrder()).toEqual({ channels: ["a", "b"], dms: ["c"], favorites: [] });
	});

	test("round-trips archived channels", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		saveArchivedChannelIds(["channel-1", "dm-1"]);
		expect(loadArchivedChannelIds()).toEqual(["channel-1", "dm-1"]);
	});

	test("round-trips user colors", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		saveUserColors({ "user-1": "#7dd3fc" });
		expect(loadUserColors()).toEqual({ "user-1": "#7dd3fc" });
	});

	test("round-trips the user color palette version", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		saveUserColorPaletteVersion("2");
		expect(loadUserColorPaletteVersion()).toBe("2");
	});
});
