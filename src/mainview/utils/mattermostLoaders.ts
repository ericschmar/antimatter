import { MattermostApiClient } from "../mattermostApi";
import type {
	MattermostChannel,
	MattermostPost,
	MattermostUser,
} from "../types";
import {
	directChannelOtherUserId,
	isTeamChannel,
} from "./format";

export async function getPostUsers(
	api: MattermostApiClient,
	posts: MattermostPost[],
	currentUserId?: string,
) {
	const userIds = [
		...new Set(
			posts
				.map((post) => post.user_id)
				.filter((userId) => userId && userId !== currentUserId),
		),
	];
	return getUsersByIdsSafely(api, userIds);
}

export async function getUsersForIds(
	api: MattermostApiClient,
	userIds: string[],
	currentUserId?: string,
) {
	const uniqueUserIds = [
		...new Set(userIds.filter((userId) => userId && userId !== currentUserId)),
	];
	return getUsersByIdsSafely(api, uniqueUserIds);
}

export async function getChannelMembers(
	api: MattermostApiClient,
	channelId: string,
) {
	try {
		return await api.getChannelMembers(channelId);
	} catch {
		return [];
	}
}

export async function getDirectChannelUsers(
	api: MattermostApiClient,
	channels: MattermostChannel[],
	currentUserId: string,
) {
	const userIds = [
		...new Set(
			channels
				.map((channel) => directChannelOtherUserId(channel, currentUserId))
				.filter((userId): userId is string => Boolean(userId)),
		),
	];
	return getUsersByIdsSafely(api, userIds);
}

export function preferredFirstChannel(channels: MattermostChannel[]) {
	return channels.find(isTeamChannel) ?? channels[0];
}

async function getUsersByIdsSafely(
	api: MattermostApiClient,
	userIds: string[],
): Promise<MattermostUser[]> {
	if (userIds.length === 0) return [];

	try {
		return await api.getUsersByIds(userIds);
	} catch {
		return [];
	}
}
