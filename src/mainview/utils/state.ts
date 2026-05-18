import type { MattermostPost, MattermostReaction, MattermostUser, NormalizedState } from "../types";

export function addPost(state: NormalizedState, post: MattermostPost): NormalizedState {
	if (state.posts[post.id]) return state;
	return {
		...state,
		posts: { ...state.posts, [post.id]: post },
		postOrder: [...state.postOrder, post.id],
	};
}

export function replacePost(
	state: NormalizedState,
	oldId: string,
	post: MattermostPost,
): NormalizedState {
	const nextPosts = { ...state.posts };
	delete nextPosts[oldId];
	nextPosts[post.id] = post;
	const nextPostOrder: string[] = [];
	const seenPostIds = new Set<string>();
	for (const id of state.postOrder) {
		const nextId = id === oldId ? post.id : id;
		if (seenPostIds.has(nextId)) continue;
		seenPostIds.add(nextId);
		nextPostOrder.push(nextId);
	}
	return {
		...state,
		posts: nextPosts,
		postOrder: nextPostOrder,
	};
}

export function updatePost(state: NormalizedState, post: MattermostPost): NormalizedState {
	if (!state.posts[post.id]) return state;
	return {
		...state,
		posts: {
			...state.posts,
			[post.id]: post,
		},
	};
}

export function mergeUsers(state: NormalizedState, users: MattermostUser[]): NormalizedState {
	if (users.length === 0) return state;
	return {
		...state,
		users: {
			...state.users,
			...Object.fromEntries(users.map((user) => [user.id, user])),
		},
	};
}

export function updateChannelLastPostAt(
	state: NormalizedState,
	channelId: string,
	timestamp: number,
): NormalizedState {
	const channel = state.channels[channelId];
	if (!channel || (channel.last_post_at ?? 0) >= timestamp) return state;
	return {
		...state,
		channels: {
			...state.channels,
			[channelId]: {
				...channel,
				last_post_at: timestamp,
			},
		},
	};
}

export function setPostReactions(
	state: NormalizedState,
	postId: string,
	reactions: MattermostReaction[],
) {
	const post = state.posts[postId];
	if (!post) return state;
	return {
		...state,
		posts: {
			...state.posts,
			[postId]: {
				...post,
				metadata: {
					...post.metadata,
					reactions,
				},
			},
		},
	};
}

export function applyReaction(
	state: NormalizedState,
	reaction: MattermostReaction,
	removed = false,
) {
	const post = state.posts[reaction.post_id];
	if (!post) return state;
	const current = post.metadata?.reactions ?? [];
	const nextReactions = removed
		? current.filter(
				(item) =>
					item.user_id !== reaction.user_id || item.emoji_name !== reaction.emoji_name,
			)
		: current.some(
					(item) =>
						item.user_id === reaction.user_id && item.emoji_name === reaction.emoji_name,
				)
			? current
			: [...current, reaction];

	return setPostReactions(state, reaction.post_id, nextReactions);
}
