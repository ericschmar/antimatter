import { useMemo } from "react";
import { proxy, useSnapshot } from "valtio";
import {
	loadArchivedChannelIds,
	loadChannelEmojis,
	loadChannelOrder,
	loadFavoriteChannelIds,
	saveArchivedChannelIds,
	saveChannelEmojis,
	saveChannelOrder,
	saveFavoriteChannelIds,
} from "../../storage";
import type { ChannelSectionKey } from "../../types";

export const DEFAULT_SIDEBAR_WIDTH = 248;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 420;
export const DEFAULT_COMPOSER_HEIGHT = 112;
export const MIN_COMPOSER_HEIGHT = 72;
export const MAX_COMPOSER_HEIGHT = 320;

type ChannelPreferencesState = {
	archivedChannelIds: string[];
	channelEmojis: Record<string, string>;
	channelOrder: Record<string, string[]>;
	collapsedSections: Record<ChannelSectionKey, boolean>;
	favoriteChannelIds: string[];
	hydrated: boolean;
	composerHeight: number;
	sidebarWidth: number;
};

const channelPreferencesStore = proxy<ChannelPreferencesState>({
	archivedChannelIds: [],
	channelEmojis: {},
	channelOrder: {},
	collapsedSections: {
		favorites: false,
		channels: false,
		dms: false,
		archived: true,
	},
	favoriteChannelIds: [],
	hydrated: false,
	composerHeight: DEFAULT_COMPOSER_HEIGHT,
	sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
});

export function useChannelPreferences() {
	hydrateChannelPreferences();
	const preferences = useSnapshot(channelPreferencesStore);

	const favoriteChannelSet = useMemo(
		() => new Set(preferences.favoriteChannelIds),
		[preferences.favoriteChannelIds],
	);
	const archivedChannelSet = useMemo(
		() => new Set(preferences.archivedChannelIds),
		[preferences.archivedChannelIds],
	);

	function toggleFavoriteChannel(channelId: string) {
		const current = channelPreferencesStore.favoriteChannelIds;
		const next = current.includes(channelId)
			? current.filter((favoriteChannelId) => favoriteChannelId !== channelId)
			: [...current, channelId];
		channelPreferencesStore.favoriteChannelIds = next;
		saveFavoriteChannelIds(next);
	}

	function archiveChannel(channelId: string) {
		if (!channelPreferencesStore.archivedChannelIds.includes(channelId)) {
			const next = [...channelPreferencesStore.archivedChannelIds, channelId];
			channelPreferencesStore.archivedChannelIds = next;
			saveArchivedChannelIds(next);
		}

		if (channelPreferencesStore.favoriteChannelIds.includes(channelId)) {
			const next = channelPreferencesStore.favoriteChannelIds.filter(
				(favoriteChannelId) => favoriteChannelId !== channelId,
			);
			channelPreferencesStore.favoriteChannelIds = next;
			saveFavoriteChannelIds(next);
		}
	}

	function unarchiveChannel(channelId: string) {
		if (!channelPreferencesStore.archivedChannelIds.includes(channelId)) return;
		const next = channelPreferencesStore.archivedChannelIds.filter(
			(archivedChannelId) => archivedChannelId !== channelId,
		);
		channelPreferencesStore.archivedChannelIds = next;
		saveArchivedChannelIds(next);
	}

	function toggleChannelSection(section: ChannelSectionKey) {
		channelPreferencesStore.collapsedSections = {
			...channelPreferencesStore.collapsedSections,
			[section]: !channelPreferencesStore.collapsedSections[section],
		};
	}

	function setChannelEmoji(channelId: string, emoji: string) {
		const next = {
			...channelPreferencesStore.channelEmojis,
			[channelId]: emoji,
		};
		channelPreferencesStore.channelEmojis = next;
		saveChannelEmojis(next);
	}

	function moveChannel(section: ChannelSectionKey, channelIds: string[]) {
		const next = {
			...channelPreferencesStore.channelOrder,
			[section]: channelIds,
		};
		channelPreferencesStore.channelOrder = next;
		saveChannelOrder(next);
	}

	function setSidebarWidth(width: number) {
		channelPreferencesStore.sidebarWidth = width;
	}

	function setComposerHeight(height: number) {
		channelPreferencesStore.composerHeight = height;
	}

	return {
		archivedChannelSet,
		channelEmojis: preferences.channelEmojis,
		channelOrder: preferences.channelOrder,
		collapsedSections: preferences.collapsedSections,
		composerHeight: preferences.composerHeight,
		favoriteChannelSet,
		sidebarWidth: preferences.sidebarWidth,
		setComposerHeight,
		setSidebarWidth,
		archiveChannel,
		moveChannel,
		setChannelEmoji,
		toggleChannelSection,
		toggleFavoriteChannel,
		unarchiveChannel,
	};
}

function hydrateChannelPreferences() {
	if (channelPreferencesStore.hydrated) return;
	channelPreferencesStore.favoriteChannelIds = loadFavoriteChannelIds();
	channelPreferencesStore.archivedChannelIds = loadArchivedChannelIds();
	channelPreferencesStore.channelEmojis = loadChannelEmojis();
	channelPreferencesStore.channelOrder = loadChannelOrder();
	channelPreferencesStore.hydrated = true;
}
