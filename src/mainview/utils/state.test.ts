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
	applyReaction,
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
		const state: NormalizedState = { channels: {}, postOrder: [], posts: {}, teams: {}, users: {} };
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
		const websocketPost = { ...basePost, id: "post-1", message: "from websocket" };
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
		const withReactions = setPostReactions(stateWithPost(), "post-1", [reaction]);
		expect(withReactions.posts["post-1"]?.metadata?.reactions).toEqual([reaction]);

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

describe("applyChannelHistory", () => {
	const reaction: MattermostReaction = {
		emoji_name: "thumbsup",
		post_id: "post-1",
		user_id: "user-2",
	};
	const secondPost: MattermostPost = { ...basePost, id: "post-2" };

	function historyWith(posts: Record<string, MattermostPost>, postOrder: string[]): ChannelHistoryData {
		return { memberUsers: [], members: [], postOrder, posts, postUsers: [] };
	}

	test("carries over already-loaded reactions when history re-syncs", () => {
		const withReactions = setPostReactions(stateWithPost(), "post-1", [reaction]);
		// A new message arrived, so history re-syncs post-1 (reaction-less) alongside post-2.
		const history = historyWith({ "post-1": basePost, "post-2": secondPost }, ["post-1", "post-2"]);

		const merged = applyChannelHistory(withReactions, history);

		expect(merged.postOrder).toEqual(["post-1", "post-2"]);
		expect(merged.posts["post-1"]?.metadata?.reactions).toEqual([reaction]);
		expect(merged.posts["post-2"]?.metadata?.reactions).toBeUndefined();
	});

	test("does not overwrite reactions carried from server-provided history", () => {
		const serverReaction: MattermostReaction = { ...reaction, user_id: "user-9" };
		const incoming: MattermostPost = {
			...basePost,
			metadata: { reactions: [serverReaction] },
		};
		const history = historyWith({ "post-1": incoming }, ["post-1"]);

		const merged = applyChannelHistory(withoutReactionsState(), history);

		expect(merged.posts["post-1"]?.metadata?.reactions).toEqual([serverReaction]);
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

function withoutReactionsState(): NormalizedState {
	return {
		channels: {},
		postOrder: ["post-1"],
		posts: { "post-1": basePost },
		teams: {},
		users: {},
	};
}
