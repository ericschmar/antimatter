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

	test("does not flag the rendered channel unread when a chat tab is active", () => {
		const source = readFileSync(
			new URL("./useMainViewEvents.ts", import.meta.url),
			"utf8",
		);
		const handlePostBody = source.slice(
			source.indexOf("function handlePost(event: Event)"),
			source.indexOf("function handleReaction(event: Event)"),
		);

		// selectedChannelRef alone is the standalone selection; once a chat
		// workspace tab renders, its channel is the visible one and must not
		// get an unread badge (issue: active channel flagged unread until clicked).
		expect(handlePostBody).toContain(
			"const renderedChannelId = getRenderedChannelId(\n\t\t\t\tchatWorkspaceStore.workspace,\n\t\t\t\tselectedChannelRef.current,\n\t\t\t);",
		);
		expect(handlePostBody).toContain(
			"if (post.channel_id !== renderedChannelId) {",
		);
		expect(handlePostBody).not.toContain(
			"if (post.channel_id !== selectedChannelRef.current) {",
		);
	});
});
