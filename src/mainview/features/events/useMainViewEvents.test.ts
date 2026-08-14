import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("websocket post handling", () => {
	test("stores posts for non-selected channels instead of dropping them", () => {
		const source = readFileSync(
			new URL("./useMainViewEvents.ts", import.meta.url),
			"utf8",
		);
		const handlePostBody = source.slice(
			source.indexOf("function handlePost(event: Event)"),
			source.indexOf("function handleReaction(event: Event)"),
		);

		// Workspace tabs render from state.posts, and selectChannel serves the
		// history cache without revalidating. Dropping posts for non-selected
		// channels left every background chat tab stale until it became the
		// standalone channel (issue: tabbed chats never load newer messages).
		expect(handlePostBody).toContain(
			"mutateChannelHistory(post.channel_id, (current) =>\n\t\t\t\taddPostToHistory(current, post),\n\t\t\t);",
		);
		expect(handlePostBody).toContain(
			"applyIncomingPost(current, post, selectedChannelRef.current)",
		);
	});
});
