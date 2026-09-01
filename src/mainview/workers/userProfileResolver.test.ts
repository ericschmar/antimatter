import { describe, expect, test } from "bun:test";
import type { MattermostApiClient } from "../mattermostApi";
import { createUserProfileResolver } from "./userProfileResolver";

describe("createUserProfileResolver", () => {
	test("batches concurrent missing users and reuses cached profiles", async () => {
		const calls: string[][] = [];
		const api = {
			getUsersByIds: async (ids: string[]) => {
				calls.push(ids);
				return ids.map((id) => ({ id, username: id }));
			},
		} as unknown as MattermostApiClient;
		const resolver = createUserProfileResolver(api);

		const [first, second] = await Promise.all([
			resolver.resolve(["u1", "u2"], "me"),
			resolver.resolve(["u2", "u3"], "me"),
		]);

		expect(calls).toEqual([["u1", "u2", "u3"]]);
		expect(first.map((user) => user.id)).toEqual(["u1", "u2"]);
		expect(second.map((user) => user.id)).toEqual(["u2", "u3"]);
		await resolver.resolve(["u1"], "me");
		expect(calls).toHaveLength(1);
	});
});
