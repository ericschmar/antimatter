import type { MattermostApiClient } from "../mattermostApi";
import type { ChannelHistoryData } from "../types";
import {
	getChannelMembers,
	getPostUsers,
	getUsersForIds,
} from "../utils/mattermostLoaders";

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
): Promise<HistoryWaterfallResult> {
	const [postList, members] = await Promise.all([
		api.getPostsForChannel(channelId),
		getChannelMembers(api, channelId),
	]);
	const posts = postList.posts;
	const postOrder = [...postList.order].reverse();
	const [postUsers, memberUsers] = await Promise.all([
		getPostUsers(api, Object.values(posts), currentUserId),
		getUsersForIds(
			api,
			members.map((member) => member.user_id),
			currentUserId,
		),
	]);

	return {
		data: { memberUsers, members, postOrder, posts, postUsers },
		hasMore: Boolean(postList.prev_post_id),
	};
}
