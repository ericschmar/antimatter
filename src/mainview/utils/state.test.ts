import { describe, expect, test } from "bun:test";
import type {
	ChannelHistoryData,
	MattermostPost,
	MattermostReaction,
	MattermostUser,
	NormalizedState,
} from "../types";
import {
	addPost,
	applyChannelHistory,
	applyIncomingPost,
	applyReaction,
	evictInactiveChannelPosts,
	replacePost,
	setPostReactions,
	updateChannelLastPostAt,
} from "./state";

const basePost: MattermostPost = {
	id: "post-1",
	channel_id: "channel-1",
	create_at: 1,
	delete_at: 0,
	message: "hello",
	update_at: 1,
	user_id: "user-1",
};

function stateWithPost(post: MattermostPost = basePost): NormalizedState {
	return {
		channels: {},
		postOrder: [post.id],
		posts: { [post.id]: post },
		teams: {},
		users: {},
	};
}

describe("message state helpers", () => {
	test("adds a post once and preserves order", () => {
		const state: NormalizedState = {
			channels: {},
			postOrder: [],
			posts: {},
			teams: {},
			users: {},
		};
		const next = addPost(state, basePost);
		expect(next.postOrder).toEqual(["post-1"]);
		expect(addPost(next, basePost)).toBe(next);
	});

	test("replaces an optimistic post id", () => {
		const optimistic = { ...basePost, id: "client-1", pending: true };
		const next = replacePost(stateWithPost(optimistic), "client-1", basePost);
		expect(next.postOrder).toEqual(["post-1"]);
		expect(next.posts["client-1"]).toBeUndefined();
		expect(next.posts["post-1"]?.pending).toBeUndefined();
	});

	test("replaces an optimistic post without duplicating a websocket-added post", () => {
		const optimistic = { ...basePost, id: "client-1", pending: true };
		const websocketPost = {
			...basePost,
			id: "post-1",
			message: "from websocket",
		};
		const state: NormalizedState = {
			channels: {},
			postOrder: ["client-1", "post-1"],
			posts: {
				"client-1": optimistic,
				"post-1": websocketPost,
			},
			teams: {},
			users: {},
		};

		const next = replacePost(state, "client-1", basePost);
		expect(next.postOrder).toEqual(["post-1"]);
		expect(next.posts["client-1"]).toBeUndefined();
		expect(next.posts["post-1"]).toEqual(basePost);
	});

	test("sets and toggles reactions", () => {
		const reaction: MattermostReaction = {
			emoji_name: "thumbsup",
			post_id: "post-1",
			user_id: "user-2",
		};
		const withReactions = setPostReactions(stateWithPost(), "post-1", [
			reaction,
		]);
		expect(withReactions.posts["post-1"]?.metadata?.reactions).toEqual([
			reaction,
		]);

		const removed = applyReaction(withReactions, reaction, true);
		expect(removed.posts["post-1"]?.metadata?.reactions).toEqual([]);

		const readded = applyReaction(removed, reaction);
		expect(readded.posts["post-1"]?.metadata?.reactions).toEqual([reaction]);
	});

	test("updates channel activity without moving backwards", () => {
		const state: NormalizedState = {
			channels: {
				"channel-1": {
					id: "channel-1",
					team_id: "",
					name: "user-1__user-2",
					display_name: "",
					type: "D",
					last_post_at: 100,
				},
			},
			postOrder: [],
			posts: {},
			teams: {},
			users: {},
		};

		const older = updateChannelLastPostAt(state, "channel-1", 50);
		expect(older).toBe(state);

		const newer = updateChannelLastPostAt(state, "channel-1", 150);
		expect(newer.channels["channel-1"]?.last_post_at).toBe(150);
	});
});

describe("applyIncomingPost", () => {
	const selectedChannelPost: MattermostPost = {
		...basePost,
		channel_id: "channel-a",
		id: "post-a1",
	};
	const state: NormalizedState = {
		channels: {},
		postOrder: ["post-a1"],
		posts: { "post-a1": selectedChannelPost },
		teams: {},
		users: {},
	};

	test("appends posts for the selected channel to postOrder", () => {
		const next = applyIncomingPost(
			state,
			{ ...basePost, channel_id: "channel-a", id: "post-a2" },
			"channel-a",
		);

		expect(next.posts["post-a2"]?.message).toBe("hello");
		expect(next.postOrder).toEqual(["post-a1", "post-a2"]);
	});

	test("stores posts for loaded background channels without touching postOrder", () => {
		// postOrder orders the standalone timeline of the selected channel
		// only, so a background channel's post must not join it.
		const loaded: NormalizedState = {
			...state,
			posts: {
				...state.posts,
				"post-b0": { ...basePost, channel_id: "channel-b", id: "post-b0" },
			},
		};
		const next = applyIncomingPost(
			loaded,
			{ ...basePost, channel_id: "channel-b", id: "post-b1" },
			"channel-a",
		);

		expect(next.posts["post-b1"]?.message).toBe("hello");
		expect(next.postOrder).toEqual(["post-a1"]);
	});

	test("ignores posts for channels that were never loaded", () => {
		const next = applyIncomingPost(
			state,
			{ ...basePost, channel_id: "channel-c", id: "post-c1" },
			"channel-a",
		);

		expect(next).toBe(state);
	});

	test("updates an existing background-channel post in place", () => {
		const loaded: NormalizedState = {
			...state,
			posts: {
				...state.posts,
				"post-b1": { ...basePost, channel_id: "channel-b", id: "post-b1" },
			},
		};
		const edited = {
			...basePost,
			channel_id: "channel-b",
			id: "post-b1",
			message: "edited",
			update_at: 2,
		};

		const next = applyIncomingPost(loaded, edited, "channel-a");

		expect(next.posts["post-b1"]?.message).toBe("edited");
		expect(next.postOrder).toEqual(["post-a1"]);
	});
});

describe("applyChannelHistory postOrder", () => {
	const standalonePost: MattermostPost = {
		...basePost,
		channel_id: "channel-a",
		id: "post-a1",
	};
	const state: NormalizedState = {
		channels: {},
		postOrder: ["post-a1"],
		posts: { "post-a1": standalonePost },
		teams: {},
		users: {},
	};
	const history = {
		memberUsers: [],
		members: [],
		postOrder: ["post-b1"],
		posts: {
			"post-b1": {
				...basePost,
				channel_id: "channel-b",
				id: "post-b1",
			} as MattermostPost,
		},
		postUsers: [],
	} satisfies ChannelHistoryData;

	test("can replace a background channel's posts without replacing postOrder", () => {
		const merged = applyChannelHistory(state, history, false);

		expect(Object.keys(merged.posts)).toEqual(["post-a1", "post-b1"]);
		expect(merged.postOrder).toEqual(["post-a1"]);
	});

	test("replaces postOrder by default", () => {
		expect(applyChannelHistory(state, history).postOrder).toEqual(["post-b1"]);
	});
});

describe("applyChannelHistory", () => {
	const reaction: MattermostReaction = {
		emoji_name: "thumbsup",
		post_id: "post-1",
		user_id: "user-2",
	};
	const secondPost: MattermostPost = { ...basePost, id: "post-2" };

	function historyWith(
		posts: Record<string, MattermostPost>,
		postOrder: string[],
	): ChannelHistoryData {
		return { memberUsers: [], members: [], postOrder, posts, postUsers: [] };
	}

	test("carries over already-loaded reactions when history re-syncs", () => {
		const withReactions = setPostReactions(stateWithPost(), "post-1", [
			reaction,
		]);
		// A new message arrived, so history re-syncs post-1 (reaction-less) alongside post-2.
		const history = historyWith({ "post-1": basePost, "post-2": secondPost }, [
			"post-1",
			"post-2",
		]);

		const merged = applyChannelHistory(withReactions, history);

		expect(merged.postOrder).toEqual(["post-1", "post-2"]);
		expect(merged.posts["post-1"]?.metadata?.reactions).toEqual([reaction]);
		expect(merged.posts["post-2"]?.metadata?.reactions).toBeUndefined();
	});

	test("preserves posts from other channels when history re-syncs", () => {
		const otherChannelPost: MattermostPost = {
			...basePost,
			channel_id: "channel-2",
			id: "post-3",
		};
		const state: NormalizedState = {
			...stateWithPost(otherChannelPost),
			postOrder: ["post-3", "post-1"],
			posts: {
				"post-1": basePost,
				"post-3": otherChannelPost,
			},
		};
		const updatedPost: MattermostPost = {
			...basePost,
			message: "updated selected channel history",
		};
		const history = historyWith({ "post-1": updatedPost }, ["post-1"]);

		const merged = applyChannelHistory(state, history);

		expect(merged.posts["post-1"]).toEqual(updatedPost);
		expect(merged.posts["post-3"]).toEqual(otherChannelPost);
		expect(merged.postOrder).toEqual(["post-1"]);
	});

	test("does not overwrite reactions carried from server-provided history", () => {
		const serverReaction: MattermostReaction = {
			...reaction,
			user_id: "user-9",
		};
		const incoming: MattermostPost = {
			...basePost,
			metadata: { reactions: [serverReaction] },
		};
		const history = historyWith({ "post-1": incoming }, ["post-1"]);

		const merged = applyChannelHistory(withoutReactionsState(), history);

		expect(merged.posts["post-1"]?.metadata?.reactions).toEqual([
			serverReaction,
		]);
	});

	test("merges history users into state", () => {
		const user: MattermostUser = {
			id: "user-3",
			username: "third",
			is_bot: false,
		} as MattermostUser;
		const history = historyWith({ "post-1": basePost }, ["post-1"]);
		history.postUsers = [user];

		const merged = applyChannelHistory(stateWithPost(), history);

		expect(merged.users["user-3"]).toBe(user);
	});
});

describe("resident post cap", () => {
	function postAt(id: string, channelId: string, createAt: number): MattermostPost {
		return { ...basePost, id, channel_id: channelId, create_at: createAt };
	}

	test("addPost trims the oldest posts once the channel exceeds the resident cap", () => {
		let state: NormalizedState = {
			channels: {},
			postOrder: [],
			posts: {},
			teams: {},
			users: {},
		};
		for (let i = 0; i < 502; i++) {
			state = addPost(state, postAt(`post-${i}`, "channel-1", i));
		}
		expect(state.postOrder).toHaveLength(500);
		expect(state.posts["post-0"]).toBeUndefined();
		expect(state.posts["post-1"]).toBeUndefined();
		expect(state.posts["post-2"]).toBeDefined();
		expect(state.posts["post-501"]).toBeDefined();
		expect(state.postOrder.at(0)).toBe("post-2");
		expect(state.postOrder.at(-1)).toBe("post-501");
	});

	test("addPost trimming only affects the incoming post's channel", () => {
		let state: NormalizedState = {
			channels: {},
			postOrder: ["other-channel-post"],
			posts: {
				"other-channel-post": postAt("other-channel-post", "channel-2", 0),
			},
			teams: {},
			users: {},
		};
		for (let i = 0; i < 501; i++) {
			state = addPost(state, postAt(`post-${i}`, "channel-1", i + 1));
		}
		expect(state.posts["other-channel-post"]).toBeDefined();
	});

	test("applyIncomingPost trims background-channel posts oldest-first by create_at", () => {
		// applyIncomingPost only accumulates posts for a background channel once
		// at least one of its posts is already resident, so seed the first one.
		let state: NormalizedState = {
			channels: {},
			postOrder: [],
			posts: { "post-0": postAt("post-0", "channel-1", 0) },
			teams: {},
			users: {},
		};
		for (let i = 1; i < 502; i++) {
			state = applyIncomingPost(
				state,
				postAt(`post-${i}`, "channel-1", i),
				"other-selected-channel",
			);
		}
		const residentIds = Object.keys(state.posts);
		expect(residentIds).toHaveLength(500);
		expect(state.posts["post-0"]).toBeUndefined();
		expect(state.posts["post-1"]).toBeUndefined();
		expect(state.posts["post-501"]).toBeDefined();
	});
});

describe("evictInactiveChannelPosts", () => {
	test("removes posts for channels not in the active set", () => {
		const state: NormalizedState = {
			channels: {},
			postOrder: ["post-1", "post-2", "post-3"],
			posts: {
				"post-1": { ...basePost, id: "post-1", channel_id: "channel-1" },
				"post-2": { ...basePost, id: "post-2", channel_id: "channel-2" },
				"post-3": { ...basePost, id: "post-3", channel_id: "channel-1" },
			},
			teams: {},
			users: {},
		};
		const activeChannels = new Set(["channel-1"]);
		const evicted = evictInactiveChannelPosts(state, activeChannels);
		expect(Object.keys(evicted.posts)).toEqual(["post-1", "post-3"]);
		expect(evicted.posts["post-2"]).toBeUndefined();
	});

	test("returns the same state when all channels are active", () => {
		const state: NormalizedState = {
			channels: {},
			postOrder: ["post-1"],
			posts: {
				"post-1": { ...basePost, id: "post-1", channel_id: "channel-1" },
			},
			teams: {},
			users: {},
		};
		const activeChannels = new Set(["channel-1"]);
		const evicted = evictInactiveChannelPosts(state, activeChannels);
		expect(evicted).toBe(state);
	});

	test("removes all posts when no channels are active", () => {
		const state: NormalizedState = {
			channels: {},
			postOrder: ["post-1", "post-2"],
			posts: {
				"post-1": { ...basePost, id: "post-1", channel_id: "channel-1" },
				"post-2": { ...basePost, id: "post-2", channel_id: "channel-2" },
			},
			teams: {},
			users: {},
		};
		const activeChannels = new Set<string>();
		const evicted = evictInactiveChannelPosts(state, activeChannels);
		expect(Object.keys(evicted.posts)).toEqual([]);
	});
});

function withoutReactionsState(): NormalizedState {
	return {
		channels: {},
		postOrder: ["post-1"],
		posts: { "post-1": basePost },
		teams: {},
		users: {},
	};
}
