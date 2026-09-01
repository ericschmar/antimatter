import type { MattermostApiClient } from "../mattermostApi";
import type { MattermostReaction } from "../types";

export function createReactionScheduler(deps: {
	api: MattermostApiClient;
	apply: (reactions: Array<{ postId: string; reactions: MattermostReaction[] }>) => void;
	maxConcurrent?: number;
}) {
	const maxConcurrent = deps.maxConcurrent ?? 4;
	const queued = new Map<string, string>();
	const inFlight = new Set<string>();
	const completed: Array<{ postId: string; reactions: MattermostReaction[] }> = [];
	let activeChannelId: string | null = null;
	let flushScheduled = false;

	function flushCompleted() {
		flushScheduled = false;
		if (completed.length) deps.apply(completed.splice(0));
	}

	function pump() {
		while (inFlight.size < maxConcurrent && queued.size) {
			const [postId, channelId] = queued.entries().next().value as [string, string];
			queued.delete(postId);
			inFlight.add(postId);
			void deps.api
				.getReactionsForPost(postId)
				.then((reactions) => {
					if (activeChannelId === channelId) {
						completed.push({ postId, reactions });
						if (!flushScheduled) {
							flushScheduled = true;
							queueMicrotask(flushCompleted);
						}
					}
				})
				.catch(() => undefined)
				.finally(() => {
					inFlight.delete(postId);
					pump();
				});
		}
	}

	return {
		setActiveChannel(channelId: string) {
			activeChannelId = channelId;
			for (const [postId, queuedChannelId] of queued) {
				if (queuedChannelId !== channelId) queued.delete(postId);
			}
		},
		schedule(channelId: string, postIds: string[]) {
			for (const postId of postIds) {
				if (!inFlight.has(postId)) queued.set(postId, channelId);
			}
			pump();
		},
		reset() {
			queued.clear();
			completed.length = 0;
			activeChannelId = null;
		},
	};
}
