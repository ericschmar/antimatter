import type { MattermostPost } from "../types";
import { dayKey, formatDateDivider } from "./format";

export type TimelineRow =
	| { type: "divider"; key: string; label: string }
	| {
			type: "message";
			key: string;
			post: MattermostPost;
			replies: MattermostPost[];
	  };

// Memoized by the posts array reference: avatars and presence stream in
// without changing the posts array, so the same reference is passed on every
// rebuild. Returning the same rows (and reply arrays) keeps downstream
// per-message memoization stable. See Phase 1c.
let cachedPosts: MattermostPost[] | null = null;
let cachedRows: TimelineRow[] = [];

export function __resetTimelineRowsCache(): void {
	cachedPosts = null;
	cachedRows = [];
}

export function buildTimelineRows(posts: MattermostPost[]): TimelineRow[] {
	if (posts === cachedPosts) return cachedRows;
	cachedRows = computeTimelineRows(posts);
	cachedPosts = posts;
	return cachedRows;
}

function computeTimelineRows(posts: MattermostPost[]): TimelineRow[] {
	const rows: TimelineRow[] = [];
	let previousDayKey: string | null = null;
	const postsById = new Map(posts.map((post) => [post.id, post]));
	const repliesByRootId = new Map<string, MattermostPost[]>();
	const topLevelPosts: MattermostPost[] = [];

	for (const post of posts) {
		if (
			post.root_id &&
			post.root_id !== post.id &&
			postsById.has(post.root_id)
		) {
			const replies = repliesByRootId.get(post.root_id) ?? [];
			replies.push(post);
			repliesByRootId.set(post.root_id, replies);
			continue;
		}
		topLevelPosts.push(post);
	}

	topLevelPosts.sort((a, b) => a.create_at - b.create_at);
	for (const replies of repliesByRootId.values()) {
		replies.sort((a, b) => a.create_at - b.create_at);
	}

	for (const post of topLevelPosts) {
		const currentDayKey = dayKey(post.create_at);
		if (currentDayKey !== previousDayKey) {
			rows.push({
				type: "divider",
				key: `divider-${currentDayKey}`,
				label: formatDateDivider(post.create_at),
			});
			previousDayKey = currentDayKey;
		}
		rows.push({
			type: "message",
			key: post.id,
			post,
			replies: repliesByRootId.get(post.id) ?? [],
		});
	}

	return rows;
}
