import { afterEach, describe, expect, test } from "bun:test";
import {
	loadArchivedChannelIds,
	loadChannelEmojis,
	loadChannelOrder,
	loadDismissedAppUpdateBannerKey,
	loadSettings,
	loadUserColorPaletteVersion,
	loadUserColors,
	saveArchivedChannelIds,
	saveChannelEmojis,
	saveChannelOrder,
	saveDismissedAppUpdateBannerKey,
	saveSettings,
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

	test("round-trips the dismissed app update banner key", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		saveDismissedAppUpdateBannerKey("ready:1.2.3");
		expect(loadDismissedAppUpdateBannerKey()).toBe("ready:1.2.3");
	});

	test("defaults own message indicators on for existing settings", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		expect(loadSettings()).toMatchObject({
			showOwnMessageIndicators: true,
			ownMessageIndicatorColor: "#46a758",
			showProfilePictures: true,
		});
	});

	test("round-trips disabled profile pictures", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		saveSettings({
			fontFamily: "system",
			fontSize: 14,
			theme: "default",
			showOwnMessageIndicators: false,
			ownMessageIndicatorColor: "#8b5cf6",
			notificationSounds: true,
			notificationPreference: "all",
			showProfilePictures: false,
		});
		expect(loadSettings()).toMatchObject({
			showProfilePictures: false,
		});
	});

	test("round-trips disabled own message indicators and color", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: new MemoryStorage(),
		});
		saveSettings({
			fontFamily: "system",
			fontSize: 14,
			theme: "default",
			showOwnMessageIndicators: false,
			ownMessageIndicatorColor: "#8b5cf6",
			notificationSounds: true,
			notificationPreference: "all",
			showProfilePictures: true,
		});
		expect(loadSettings()).toMatchObject({
			showOwnMessageIndicators: false,
			ownMessageIndicatorColor: "#8b5cf6",
		});
	});
});
