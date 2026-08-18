import { describe, expect, test } from "bun:test";
import type { MattermostApiClient } from "../mattermostApi";
import type { MattermostChannelMember, MattermostUser } from "../types";
import { loadChannelHistoryWaterfall } from "./historyWaterfall";

type CallLog = { method: string; arg: string };

function fakeApi(options: {
	posts?: { order: string[]; posts: Record<string, { user_id: string }> };
	prevPostId?: string;
	members?: MattermostChannelMember[];
	users?: Record<string, MattermostUser>;
	postsError?: Error;
	log: CallLog[];
}): MattermostApiClient {
	const user = (id: string): MattermostUser =>
		({ id, username: id }) as MattermostUser;
	return {
		getPostsForChannel: async (channelId: string) => {
			options.log.push({ method: "posts", arg: channelId });
			if (options.postsError) throw options.postsError;
			return {
				order: options.posts?.order ?? [],
				posts: options.posts?.posts ?? {},
				prev_post_id: options.prevPostId,
			} as never;
		},
		getChannelMembers: async (channelId: string) => {
			options.log.push({ method: "members", arg: channelId });
			return (options.members ?? []) as never;
		},
		getUsersByIds: async (userIds: string[]) => {
			options.log.push({ method: "users", arg: userIds.join(",") });
			return userIds.map(user) as never;
		},
	} as unknown as MattermostApiClient;
}

describe("loadChannelHistoryWaterfall", () => {
	test("fetches posts and members before users and returns normalized history", async () => {
		const log: CallLog[] = [];
		const api = fakeApi({
			log,
			posts: {
				order: ["p2", "p1"],
				posts: { p1: { user_id: "u1" }, p2: { user_id: "u2" } },
			},
			members: [
				{ channel_id: "ch1", user_id: "u1" },
				{ channel_id: "ch1", user_id: "u3" },
			] as MattermostChannelMember[],
		});

		const { data, hasMore } = await loadChannelHistoryWaterfall(
			api,
			"ch1",
			"me",
		);

		expect(hasMore).toBe(false);
		expect(data.postOrder).toEqual(["p1", "p2"]);
		expect(Object.keys(data.posts)).toEqual(["p1", "p2"]);
		expect(data.members).toHaveLength(2);
		// postUsers: authors minus current user; memberUsers: member ids minus
		// current user, deduped.
		expect(data.postUsers.map((u) => u.id)).toEqual(["u1", "u2"]);
		expect(data.memberUsers.map((u) => u.id)).toEqual(["u1", "u3"]);
		// Both rounds: posts+members first, users afterwards.
		expect(log.map((entry) => entry.method)).toEqual([
			"posts",
			"members",
			"users",
			"users",
		]);
	});

	test("reports hasMore when the post list has a prev_post_id", async () => {
		const log: CallLog[] = [];
		const api = fakeApi({ log, prevPostId: "p0" });

		const { hasMore } = await loadChannelHistoryWaterfall(api, "ch1", "me");

		expect(hasMore).toBe(true);
	});

	test("rejects when the posts request fails", async () => {
		const log: CallLog[] = [];
		const api = fakeApi({
			log,
			postsError: new Error("boom"),
		});

		expect(loadChannelHistoryWaterfall(api, "ch1", "me")).rejects.toThrow(
			"boom",
		);
	});
});
