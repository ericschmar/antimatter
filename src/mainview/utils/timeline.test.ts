import { describe, expect, test } from "bun:test";
import type { MattermostPost } from "../types";
import { buildTimelineRows } from "./timeline";

const rootPost: MattermostPost = {
	id: "root-1",
	channel_id: "channel-1",
	create_at: Date.UTC(2026, 0, 1),
	delete_at: 0,
	message: "root message",
	update_at: Date.UTC(2026, 0, 1),
	user_id: "user-1",
};

function post(overrides: Partial<MattermostPost>): MattermostPost {
	return {
		...rootPost,
		id: "post-1",
		message: "reply message",
		user_id: "user-2",
		...overrides,
	};
}

describe("buildTimelineRows", () => {
	test("groups loaded replies under their root message", () => {
		const reply = post({ id: "reply-1", root_id: rootPost.id });
		const rows = buildTimelineRows([rootPost, reply]);
		const messageRows = rows.filter((row) => row.type === "message");

		expect(messageRows).toHaveLength(1);
		expect(messageRows[0]?.post).toBe(rootPost);
		expect(messageRows[0]?.replies).toEqual([reply]);
	});

	test("keeps replies with missing roots as top-level messages", () => {
		const reply = post({ id: "reply-1", root_id: "missing-root" });
		const rows = buildTimelineRows([reply]);
		const messageRows = rows.filter((row) => row.type === "message");

		expect(messageRows).toHaveLength(1);
		expect(messageRows[0]?.post).toBe(reply);
		expect(messageRows[0]?.replies).toEqual([]);
	});

	test("does not group self-rooted posts", () => {
		const selfRooted = post({ id: "post-1", root_id: "post-1" });
		const rows = buildTimelineRows([selfRooted]);
		const messageRows = rows.filter((row) => row.type === "message");

		expect(messageRows).toHaveLength(1);
		expect(messageRows[0]?.post).toBe(selfRooted);
		expect(messageRows[0]?.replies).toEqual([]);
	});
});
