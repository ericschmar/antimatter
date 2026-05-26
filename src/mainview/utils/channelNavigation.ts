import type {
	ChannelNotificationState,
	ChannelSectionKey,
	MattermostChannel,
	MattermostUser,
} from "../types";
import { channelLabel } from "./format";

export type NavigableChannelSection = Exclude<ChannelSectionKey, "archived">;

export const navigableChannelSections: NavigableChannelSection[] = [
	"favorites",
	"channels",
	"dms",
];

export type ChannelNavigationContext = {
	channelOrder: Readonly<Record<string, readonly string[]>>;
	currentUserId: string;
	notifications: ChannelNotificationState;
	sections: Record<ChannelSectionKey, MattermostChannel[]>;
	selectedChannelId: string | null;
	users: Record<string, MattermostUser>;
};

export function channelActivityAt(channel: MattermostChannel) {
	return channel.last_post_at ?? channel.update_at ?? channel.create_at ?? 0;
}

export function sortChannelsForSection(
	channels: readonly MattermostChannel[],
	order: readonly string[],
	users: Record<string, MattermostUser>,
	currentUserId: string,
	section: ChannelSectionKey,
) {
	if (section === "dms") {
		return [...channels].sort((a, b) => {
			const activityDelta = channelActivityAt(b) - channelActivityAt(a);
			if (activityDelta !== 0) return activityDelta;
			return channelLabel(a, users, currentUserId).localeCompare(
				channelLabel(b, users, currentUserId),
			);
		});
	}

	const orderIndex = new Map(order.map((id, index) => [id, index]));
	return [...channels].sort((a, b) => {
		const aIndex = orderIndex.get(a.id);
		const bIndex = orderIndex.get(b.id);
		if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
		if (aIndex !== undefined) return -1;
		if (bIndex !== undefined) return 1;
		return channelLabel(a, users, currentUserId).localeCompare(
			channelLabel(b, users, currentUserId),
		);
	});
}

export function orderedSectionChannels(
	context: Pick<
		ChannelNavigationContext,
		"channelOrder" | "currentUserId" | "sections" | "users"
	>,
	section: NavigableChannelSection,
) {
	return sortChannelsForSection(
		context.sections[section],
		context.channelOrder[section] ?? [],
		context.users,
		context.currentUserId,
		section,
	);
}

export function orderedNavigableChannels(
	context: Pick<
		ChannelNavigationContext,
		"channelOrder" | "currentUserId" | "sections" | "users"
	>,
) {
	return navigableChannelSections.flatMap((section) =>
		orderedSectionChannels(context, section),
	);
}

export function findSectionStartChannel(
	context: Pick<
		ChannelNavigationContext,
		"channelOrder" | "currentUserId" | "sections" | "users"
	>,
	section: NavigableChannelSection,
) {
	return orderedSectionChannels(context, section)[0] ?? null;
}

export function findAdjacentChannel(
	channels: readonly MattermostChannel[],
	selectedChannelId: string | null,
	direction: 1 | -1,
) {
	if (channels.length === 0) return null;
	const currentIndex = selectedChannelId
		? channels.findIndex((channel) => channel.id === selectedChannelId)
		: -1;
	const nextIndex =
		currentIndex < 0
			? direction > 0
				? 0
				: channels.length - 1
			: (currentIndex + direction + channels.length) % channels.length;
	return channels[nextIndex] ?? null;
}

export function findAdjacentVisibleChannel(
	context: ChannelNavigationContext,
	direction: 1 | -1,
) {
	return findAdjacentChannel(
		orderedNavigableChannels(context),
		context.selectedChannelId,
		direction,
	);
}

export function findAdjacentUnreadChannel(
	context: ChannelNavigationContext,
	direction: 1 | -1,
) {
	const channels = orderedNavigableChannels(context).filter((channel) => {
		const notification = context.notifications[channel.id];
		return notification?.mention || notification?.unread;
	});
	const mentioned = channels.filter(
		(channel) => context.notifications[channel.id]?.mention,
	);
	return findAdjacentChannel(
		mentioned.length > 0 ? mentioned : channels,
		context.selectedChannelId,
		direction,
	);
}

export function findAdjacentMentionChannel(
	context: ChannelNavigationContext,
	direction: 1 | -1,
) {
	return findAdjacentChannel(
		orderedNavigableChannels(context).filter(
			(channel) => context.notifications[channel.id]?.mention,
		),
		context.selectedChannelId,
		direction,
	);
}
