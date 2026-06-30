import type { AppSettings, MattermostConfig } from "./types";
import { normalizeUserColor } from "./utils/userColors";

const CONFIG_KEY = "mm-clone:config";
const FAVORITE_CHANNELS_KEY = "mm-clone:favorite-channels";
const ARCHIVED_CHANNELS_KEY = "mm-clone:archived-channels";
const CHANNEL_EMOJIS_KEY = "mm-clone:channel-emojis";
const CHANNEL_ORDER_KEY = "mm-clone:channel-order";
const USER_COLORS_KEY = "mm-clone:user-colors";
const USER_COLOR_PALETTE_VERSION_KEY = "mm-clone:user-color-palette-version";
const SETTINGS_KEY = "mm-clone:settings";
const DISMISSED_APP_UPDATE_BANNER_KEY = "mm-clone:dismissed-app-update-banner";

export const defaultSettings: AppSettings = {
	fontFamily: "system",
	fontSize: 14,
	theme: "default",
	showOwnMessageIndicators: true,
	ownMessageIndicatorColor: "#46a758",
	notificationSounds: true,
	notificationPreference: "all",
	showProfilePictures: true,
};

export function loadConfig(): MattermostConfig | null {
	const raw = localStorage.getItem(CONFIG_KEY);
	if (!raw) return null;

	try {
		const config = JSON.parse(raw) as Partial<MattermostConfig>;
		if (!config.serverUrl || !config.token) return null;
		const authMethod =
			config.authMethod === "password" || config.authMethod === "sso"
				? config.authMethod
				: "pat";
		return {
			serverUrl: config.serverUrl,
			token: config.token,
			authMethod,
			lastTeamId: config.lastTeamId,
			lastChannelId: config.lastChannelId,
		};
	} catch {
		return null;
	}
}

export function saveConfig(config: MattermostConfig) {
	localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearConfig() {
	localStorage.removeItem(CONFIG_KEY);
}

export function loadFavoriteChannelIds(): string[] {
	return readStringArray(FAVORITE_CHANNELS_KEY);
}

export function saveFavoriteChannelIds(channelIds: string[]) {
	localStorage.setItem(FAVORITE_CHANNELS_KEY, JSON.stringify(channelIds));
}

export function loadArchivedChannelIds(): string[] {
	return readStringArray(ARCHIVED_CHANNELS_KEY);
}

export function saveArchivedChannelIds(channelIds: string[]) {
	localStorage.setItem(ARCHIVED_CHANNELS_KEY, JSON.stringify(channelIds));
}

export function loadChannelEmojis(): Record<string, string> {
	return readStringRecord(CHANNEL_EMOJIS_KEY);
}

export function saveChannelEmojis(channelEmojis: Record<string, string>) {
	localStorage.setItem(CHANNEL_EMOJIS_KEY, JSON.stringify(channelEmojis));
}

export function loadChannelOrder(): Record<string, string[]> {
	const raw = localStorage.getItem(CHANNEL_ORDER_KEY);
	if (!raw) return {};

	try {
		const value = JSON.parse(raw) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, ids]) => Array.isArray(ids))
				.map(([key, ids]) => [
					key,
					(ids as unknown[]).filter((id): id is string => typeof id === "string"),
				]),
		);
	} catch {
		return {};
	}
}

export function saveChannelOrder(channelOrder: Record<string, string[]>) {
	localStorage.setItem(CHANNEL_ORDER_KEY, JSON.stringify(channelOrder));
}

export function loadUserColors(): Record<string, string> {
	return readStringRecord(USER_COLORS_KEY);
}

export function saveUserColors(userColors: Record<string, string>) {
	localStorage.setItem(USER_COLORS_KEY, JSON.stringify(userColors));
}

export function loadUserColorPaletteVersion() {
	return localStorage.getItem(USER_COLOR_PALETTE_VERSION_KEY);
}

export function saveUserColorPaletteVersion(version: string) {
	localStorage.setItem(USER_COLOR_PALETTE_VERSION_KEY, version);
}

export function loadSettings(): AppSettings {
	const raw = localStorage.getItem(SETTINGS_KEY);
	if (!raw) return defaultSettings;

	try {
		const value = JSON.parse(raw) as Partial<AppSettings>;
		return normalizeSettings(value);
	} catch {
		return defaultSettings;
	}
}

export function saveSettings(settings: AppSettings) {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function loadDismissedAppUpdateBannerKey() {
	return localStorage.getItem(DISMISSED_APP_UPDATE_BANNER_KEY);
}

export function saveDismissedAppUpdateBannerKey(key: string) {
	localStorage.setItem(DISMISSED_APP_UPDATE_BANNER_KEY, key);
}

function normalizeSettings(value: Partial<AppSettings>): AppSettings {
	return {
		fontFamily:
			typeof value.fontFamily === "string" && value.fontFamily.trim()
				? value.fontFamily
				: defaultSettings.fontFamily,
		fontSize:
			typeof value.fontSize === "number" &&
			Number.isFinite(value.fontSize) &&
			value.fontSize >= 12 &&
			value.fontSize <= 18
				? value.fontSize
				: defaultSettings.fontSize,
		theme:
			value.theme === "high-contrast" ||
			value.theme === "warm" ||
			value.theme === "light"
				? value.theme
				: "default",
		showOwnMessageIndicators:
			typeof value.showOwnMessageIndicators === "boolean"
				? value.showOwnMessageIndicators
				: defaultSettings.showOwnMessageIndicators,
		ownMessageIndicatorColor:
			typeof value.ownMessageIndicatorColor === "string"
				? normalizeUserColor(value.ownMessageIndicatorColor) ??
					defaultSettings.ownMessageIndicatorColor
				: defaultSettings.ownMessageIndicatorColor,
		notificationSounds:
			typeof value.notificationSounds === "boolean"
				? value.notificationSounds
				: defaultSettings.notificationSounds,
		notificationPreference:
			value.notificationPreference === "mentions" ||
			value.notificationPreference === "none"
				? value.notificationPreference
				: "all",
		showProfilePictures:
			typeof value.showProfilePictures === "boolean"
				? value.showProfilePictures
				: defaultSettings.showProfilePictures,
	};
}

function readStringRecord(key: string): Record<string, string> {
	const raw = localStorage.getItem(key);
	if (!raw) return {};

	try {
		const value = JSON.parse(raw) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		);
	} catch {
		return {};
	}
}

function readStringArray(key: string) {
	const raw = localStorage.getItem(key);
	if (!raw) return [];

	try {
		const value = JSON.parse(raw) as unknown;
		if (!Array.isArray(value)) return [];
		return value.filter((item): item is string => typeof item === "string");
	} catch {
		return [];
	}
}
