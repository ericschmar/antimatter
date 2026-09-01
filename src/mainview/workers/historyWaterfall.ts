import type { MattermostApiClient } from "../mattermostApi";
import type { ChannelHistoryData } from "../types";
import {
	getChannelMembers,
	getPostUsers,
} from "../utils/mattermostLoaders";
import type { UserProfileResolver } from "./userProfileResolver";

export type HistoryWaterfallResult = {
	data: ChannelHistoryData;
	hasMore: boolean;
};

/**
 * Channel history waterfall shared by the worker and the main-thread
 * fallback. Round 1 fetches posts and channel members in parallel; round 2
 * resolves the users referenced by each. Returns `hasMore` instead of
 * committing the side effect so it can run off the main thread.
 */
export async function loadChannelHistoryWaterfall(
	api: MattermostApiClient,
	channelId: string,
	currentUserId?: string,
	resolver?: UserProfileResolver,
): Promise<HistoryWaterfallResult> {
	const postList = await api.getPostsForChannel(channelId);
	const posts = postList.posts;
	const postOrder = [...postList.order].reverse();
	const postUsers = resolver
		? await resolver.resolve(
				Object.values(posts).map((post) => post.user_id),
				currentUserId,
			)
		: await getPostUsers(api, Object.values(posts), currentUserId);

	return {
		data: { memberUsers: [], members: [], postOrder, posts, postUsers },
		hasMore: Boolean(postList.prev_post_id),
	};
}

export async function loadChannelMembersWaterfall(
	api: MattermostApiClient,
	channelId: string,
	currentUserId: string | undefined,
	resolver: UserProfileResolver,
) {
	const members = await getChannelMembers(api, channelId);
	const memberUsers = await resolver.resolve(
		members.map((member) => member.user_id),
		currentUserId,
	);
	return { members, memberUsers };
}
