import { describe, expect, test } from "bun:test";
import type { MattermostPost, MattermostReaction, NormalizedState } from "../types";
import {
	addPost,
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
