import type {
	ChannelHistoryData,
	MattermostPost,
	MattermostReaction,
	MattermostUser,
	NormalizedState,
} from "../types";

// Upper bound on how many posts of a single channel stay resident in memory
// while that channel keeps receiving websocket posts. Without this, a
// channel left open (in a tab or standalone) for days accumulates every post
// it ever receives, which grows both the JS heap and the number of message
// rows the (non-virtualized) timeline mounts. Older posts beyond the cap are
// dropped; "load more" re-fetches them from the server on demand, so this
// only affects how much scrollback stays resident, not what's reachable.
const MAX_RESIDENT_POSTS_PER_CHANNEL = 100;

export function addPost(
	state: NormalizedState,
	post: MattermostPost,
): NormalizedState {
	if (state.posts[post.id]) return state;
	const postOrder = [...state.postOrder, post.id];
	const posts = { ...state.posts, [post.id]: post };
	return trimResidentPosts(
		{
			...state,
			posts,
			postOrder,
		},
		post.channel_id,
	);
}

// Drops the oldest resident posts for a channel once it exceeds
// MAX_RESIDENT_POSTS_PER_CHANNEL. Only trims postOrder entries (the
// standalone timeline's single-channel order), never touches posts for
// other channels, and is a no-op below the cap.
function trimResidentPosts(
	state: NormalizedState,
	channelId: string,
): NormalizedState {
	const channelPostIds = state.postOrder.filter(
		(id) => state.posts[id]?.channel_id === channelId,
	);
	if (channelPostIds.length <= MAX_RESIDENT_POSTS_PER_CHANNEL) return state;
	const excess = channelPostIds.length - MAX_RESIDENT_POSTS_PER_CHANNEL;
	const idsToDrop = new Set(channelPostIds.slice(0, excess));
	const posts = { ...state.posts };
	for (const id of idsToDrop) delete posts[id];
	return {
		...state,
		posts,
		postOrder: state.postOrder.filter((id) => !idsToDrop.has(id)),
	};
}

// Same cap applied to posts for a background channel (a workspace tab that
// isn't the standalone selection), which have no postOrder entry of their
// own — trimmed oldest-first by create_at instead.
function trimResidentBackgroundPosts(
	posts: Record<string, MattermostPost>,
	channelId: string,
): Record<string, MattermostPost> {
	const channelPosts = Object.values(posts)
		.filter((post) => post.channel_id === channelId)
		.sort((left, right) => left.create_at - right.create_at);
	if (channelPosts.length <= MAX_RESIDENT_POSTS_PER_CHANNEL) return posts;
	const excess = channelPosts.length - MAX_RESIDENT_POSTS_PER_CHANNEL;
	const next = { ...posts };
	for (const post of channelPosts.slice(0, excess)) delete next[post.id];
	return next;
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

export function updatePost(
	state: NormalizedState,
	post: MattermostPost,
): NormalizedState {
	if (!state.posts[post.id]) return state;
	return {
		...state,
		posts: {
			...state.posts,
			[post.id]: post,
		},
	};
}

// Applies a websocket post. The selected channel's post joins postOrder (it
// orders the standalone timeline); posts for other channels join state.posts
// only when that channel is already loaded, so workspace tabs rendering from
// state.posts stay current without ever touching the standalone ordering.
export function applyIncomingPost(
	state: NormalizedState,
	post: MattermostPost,
	selectedChannelId: string | null,
): NormalizedState {
	const isSelectedChannel = post.channel_id === selectedChannelId;
	if (
		!isSelectedChannel &&
		!Object.values(state.posts).some(
			(loaded) => loaded.channel_id === post.channel_id,
		)
	) {
		return state;
	}
	if (state.posts[post.id]) return updatePost(state, post);
	if (isSelectedChannel) return addPost(state, post);
	return {
		...state,
		posts: trimResidentBackgroundPosts(
			{ ...state.posts, [post.id]: post },
			post.channel_id,
		),
	};
}

export function mergeUsers(
	state: NormalizedState,
	users: MattermostUser[],
): NormalizedState {
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
					item.user_id !== reaction.user_id ||
					item.emoji_name !== reaction.emoji_name,
			)
		: current.some(
					(item) =>
						item.user_id === reaction.user_id &&
						item.emoji_name === reaction.emoji_name,
				)
			? current
			: [...current, reaction];

	return setPostReactions(state, reaction.post_id, nextReactions);
}

export function applyChannelHistory(
	state: NormalizedState,
	history: ChannelHistoryData,
	replacePostOrder = true,
): NormalizedState {
	const historyChannelIds = new Set(
		Object.values(history.posts).map((post) => post.channel_id),
	);
	const posts: Record<string, MattermostPost> = Object.fromEntries(
		Object.entries(state.posts).filter(
			([, post]) => !historyChannelIds.has(post.channel_id),
		),
	);
	for (const [id, incoming] of Object.entries(history.posts)) {
		const carriedReactions = state.posts[id]?.metadata?.reactions;
		posts[id] =
			carriedReactions && !incoming.metadata?.reactions
				? {
						...incoming,
						metadata: { ...incoming.metadata, reactions: carriedReactions },
					}
				: incoming;
	}
	return {
		...state,
		users: {
			...state.users,
			...Object.fromEntries(history.postUsers.map((user) => [user.id, user])),
			...Object.fromEntries(history.memberUsers.map((user) => [user.id, user])),
		},
		posts,
		postOrder: replacePostOrder ? history.postOrder : state.postOrder,
	};
}

// Evicts posts for channels that are no longer actively rendered (not in the
// set of open workspace tabs and not the currently selected standalone channel).
// This prevents unbounded growth of state.posts when channels accumulate posts
// over time but are no longer visible.
export function evictInactiveChannelPosts(
	state: NormalizedState,
	activeChannelIds: ReadonlySet<string>,
): NormalizedState {
	const posts: Record<string, MattermostPost> = {};
	let changed = false;
	for (const [id, post] of Object.entries(state.posts)) {
		if (activeChannelIds.has(post.channel_id)) {
			posts[id] = post;
		} else {
			changed = true;
		}
	}
	if (!changed) return state;
	return { ...state, posts };
}
