import type { MattermostPost } from "../types";

export type PanelPostsCache = {
	channelId: string;
	posts: MattermostPost[];
} | null;

export function getStablePanelPosts(
	posts: MattermostPost[],
	channelId: string,
	previous: PanelPostsCache,
) {
	const nextPosts = posts.filter((post) => post.channel_id === channelId);
	if (
		previous?.channelId === channelId &&
		previous.posts.length === nextPosts.length &&
		previous.posts.every((post, index) => post === nextPosts[index])
	) {
		return { posts: previous.posts, cache: previous };
	}
	return { posts: nextPosts, cache: { channelId, posts: nextPosts } };
}
