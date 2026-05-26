import { useCallback, useEffect, useState } from "react";
import { MattermostApiClient } from "../../mattermostApi";
import {
	loadSettings,
	loadUserColorPaletteVersion,
	loadUserColors,
	saveSettings,
	saveUserColorPaletteVersion,
	saveUserColors,
} from "../../storage";
import type { AppSettings, MattermostUser, MattermostUserStatus } from "../../types";
import { fontFamilyCssValue } from "../../utils/settings";
import {
	colorForUserId,
	normalizeUserColor,
	USER_COLOR_PALETTE_VERSION,
} from "../../utils/userColors";

export function useUserPresence({
	api,
	users,
}: {
	api: MattermostApiClient | null;
	users: Record<string, MattermostUser>;
}) {
	const [userColors, setUserColors] = useState<Record<string, string>>(() =>
		loadUserColors(),
	);
	const [userImages, setUserImages] = useState<Record<string, string>>({});
	const [userStatuses, setUserStatuses] = useState<Record<string, MattermostUserStatus>>({});
	const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

	const setUserColor = useCallback((userId: string, color: string) => {
		const normalizedColor = normalizeUserColor(color);
		if (!normalizedColor) return;
		setUserColors((current) => {
			if (current[userId] === normalizedColor) return current;
			const next = { ...current, [userId]: normalizedColor };
			saveUserColors(next);
			return next;
		});
	}, []);

	useEffect(() => {
		const userIds = Object.keys(users);
		if (userIds.length === 0) return;
		const shouldMigratePalette =
			loadUserColorPaletteVersion() !== USER_COLOR_PALETTE_VERSION;

		setUserColors((current) => {
			let changed = false;
			const next = { ...current };
			const usedColors = new Set(
				shouldMigratePalette ? [] : Object.values(current),
			);
			for (const userId of [...userIds].sort()) {
				const existingColor = next[userId];
				if (!shouldMigratePalette && existingColor) {
					usedColors.add(existingColor);
					continue;
				}
				const color = colorForUserId(userId, usedColors);
				if (!shouldMigratePalette && next[userId]) continue;
				if (next[userId] === color) continue;
				next[userId] = color;
				usedColors.add(color);
				changed = true;
			}
			if (!changed && !shouldMigratePalette) return current;
			saveUserColors(next);
			saveUserColorPaletteVersion(USER_COLOR_PALETTE_VERSION);
			return next;
		});
	}, [users]);

	useEffect(() => {
		document.documentElement.dataset["theme"] = settings.theme;
		document.documentElement.style.setProperty("--app-font-size", `${settings.fontSize}px`);
		document.documentElement.style.setProperty(
			"--app-font-family",
			fontFamilyCssValue(settings.fontFamily),
		);
		saveSettings(settings);
	}, [settings]);

	useEffect(() => {
		if (!api) return;
		const userIds = Object.keys(users);
		if (userIds.length === 0) return;

		void api.getStatusesByIds(userIds).then((statuses) => {
			setUserStatuses((current) => ({
				...current,
				...Object.fromEntries(statuses.map((status) => [status.user_id, status])),
			}));
		}).catch(() => undefined);

		const missingImageIds = userIds.filter((userId) => !userImages[userId]);
		if (missingImageIds.length === 0) return;
		void Promise.all(
			missingImageIds.map(async (userId) => {
				try {
					return [userId, await api.getFileDataUrl(`/api/v4/users/${encodeURIComponent(userId)}/image`)] as const;
				} catch {
					return null;
				}
			}),
		).then((entries) => {
			const loaded = entries.filter((entry): entry is readonly [string, string] => Boolean(entry));
			if (loaded.length === 0) return;
			setUserImages((current) => ({ ...current, ...Object.fromEntries(loaded) }));
		});
	}, [api, users, userImages]);

	function resetUserPresence() {
		setUserImages({});
		setUserStatuses({});
	}

	return {
		settings,
		setSettings,
		userColors,
		userImages,
		userStatuses,
		setUserColor,
		setUserStatuses,
		resetUserPresence,
	};
}
