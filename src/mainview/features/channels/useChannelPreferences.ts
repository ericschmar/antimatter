import { useMemo, useState } from "react";
import type { ChannelSectionKey } from "../../types";
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

export const DEFAULT_SIDEBAR_WIDTH = 248;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 420;

export function useChannelPreferences() {
	const [favoriteChannelIds, setFavoriteChannelIds] = useState<string[]>(() =>
		loadFavoriteChannelIds(),
	);
	const [archivedChannelIds, setArchivedChannelIds] = useState<string[]>(() =>
		loadArchivedChannelIds(),
	);
	const [channelEmojis, setChannelEmojis] = useState<Record<string, string>>(
		() => loadChannelEmojis(),
	);
	const [channelOrder, setChannelOrder] = useState<Record<string, string[]>>(
		() => loadChannelOrder(),
	);
	const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
	const [collapsedSections, setCollapsedSections] = useState<
		Record<ChannelSectionKey, boolean>
	>({
		favorites: false,
		channels: false,
		dms: false,
		archived: true,
	});

	const favoriteChannelSet = useMemo(
		() => new Set(favoriteChannelIds),
		[favoriteChannelIds],
	);
	const archivedChannelSet = useMemo(
		() => new Set(archivedChannelIds),
		[archivedChannelIds],
	);

	function toggleFavoriteChannel(channelId: string) {
		setFavoriteChannelIds((current) => {
			const next = current.includes(channelId)
				? current.filter((favoriteChannelId) => favoriteChannelId !== channelId)
				: [...current, channelId];
			saveFavoriteChannelIds(next);
			return next;
		});
	}

	function archiveChannel(channelId: string) {
		setArchivedChannelIds((current) => {
			if (current.includes(channelId)) return current;
			const next = [...current, channelId];
			saveArchivedChannelIds(next);
			return next;
		});
		setFavoriteChannelIds((current) => {
			if (!current.includes(channelId)) return current;
			const next = current.filter(
				(favoriteChannelId) => favoriteChannelId !== channelId,
			);
			saveFavoriteChannelIds(next);
			return next;
		});
	}

	function unarchiveChannel(channelId: string) {
		setArchivedChannelIds((current) => {
			if (!current.includes(channelId)) return current;
			const next = current.filter(
				(archivedChannelId) => archivedChannelId !== channelId,
			);
			saveArchivedChannelIds(next);
			return next;
		});
	}

	function toggleChannelSection(section: ChannelSectionKey) {
		setCollapsedSections((current) => ({
			...current,
			[section]: !current[section],
		}));
	}

	function setChannelEmoji(channelId: string, emoji: string) {
		setChannelEmojis((current) => {
			const next = { ...current, [channelId]: emoji };
			saveChannelEmojis(next);
			return next;
		});
	}

	function moveChannel(section: ChannelSectionKey, channelIds: string[]) {
		setChannelOrder((current) => {
			const next = { ...current, [section]: channelIds };
			saveChannelOrder(next);
			return next;
		});
	}

	return {
		archivedChannelSet,
		channelEmojis,
		channelOrder,
		collapsedSections,
		favoriteChannelSet,
		sidebarWidth,
		setSidebarWidth,
		archiveChannel,
		moveChannel,
		setChannelEmoji,
		toggleChannelSection,
		toggleFavoriteChannel,
		unarchiveChannel,
	};
}
