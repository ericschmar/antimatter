import type { MattermostChannel, MattermostUser } from "../types";

export function userLabel(user: MattermostUser | undefined, fallback: string) {
	if (!user) return fallback;
	const displayName = [user.first_name, user.last_name]
		.filter(Boolean)
		.join(" ");
	return displayName || user.nickname || `@${user.username}`;
}

export function initials(value: string) {
	return value
		.split(/\s|-/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("");
}

export function formatTime(timestamp: number) {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

export function dayKey(timestamp: number) {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function formatDateDivider(timestamp: number) {
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(timestamp));
}

export function channelLabel(
	channel: MattermostChannel,
	users?: Record<string, MattermostUser>,
	currentUserId?: string,
) {
	if (channel.type === "D" && users && currentUserId) {
		const otherUserId = directChannelOtherUserId(channel, currentUserId);
		if (otherUserId) {
			const label = userLabel(users[otherUserId], otherUserId);
			return otherUserId === currentUserId ? `${label} (You)` : label;
		}
	}
	return channel.display_name || channel.name;
}

export function isDirectChannel(channel: MattermostChannel) {
	return channel.type === "D" || channel.type === "G";
}

export function isTeamChannel(channel: MattermostChannel) {
	return channel.type === "O" || channel.type === "P";
}

export function includesMention(message: string, username: string) {
	const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(
		`(^|\\s)@(${escapedUsername}|channel|here)(?=\\b|\\s|$)`,
		"i",
	).test(message);
}

export function directChannelOtherUserId(
	channel: MattermostChannel,
	currentUserId: string,
) {
	if (channel.type !== "D") return null;
	const userIds = channel.name.split("__").filter(Boolean);
	return userIds.find((userId) => userId !== currentUserId) ?? userIds[0] ?? null;
}
