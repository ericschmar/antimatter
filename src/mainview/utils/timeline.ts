import type { MattermostPost } from "../types";
import { dayKey, formatDateDivider } from "./format";

export type TimelineRow =
	| { type: "divider"; key: string; label: string }
	| { type: "message"; key: string; post: MattermostPost; replies: MattermostPost[] };

export function buildTimelineRows(posts: MattermostPost[]): TimelineRow[] {
	const rows: TimelineRow[] = [];
	let previousDayKey: string | null = null;
	const postsById = new Map(posts.map((post) => [post.id, post]));
	const repliesByRootId = new Map<string, MattermostPost[]>();
	const topLevelPosts: MattermostPost[] = [];

	for (const post of posts) {
		if (post.root_id && post.root_id !== post.id && postsById.has(post.root_id)) {
			const replies = repliesByRootId.get(post.root_id) ?? [];
			replies.push(post);
			repliesByRootId.set(post.root_id, replies);
			continue;
		}
		topLevelPosts.push(post);
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
