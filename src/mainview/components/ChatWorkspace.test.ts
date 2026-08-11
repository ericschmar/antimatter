import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { MattermostPost } from "../types";
import { getStablePanelPosts } from "./chatWorkspacePanelPosts";

function post(overrides: Partial<MattermostPost>): MattermostPost {
	return {
		id: "post-1",
		create_at: 1,
		update_at: 1,
		delete_at: 0,
		user_id: "user-1",
		channel_id: "channel-1",
		message: "hello",
		...overrides,
	};
}

describe("ChatWorkspace panel layout", () => {
	test("renders each chat panel as header, timeline, then composer", () => {
		const source = readFileSync(
			"src/mainview/components/ChatWorkspace.tsx",
			"utf8",
		);
		const headerIndex = source.indexOf("<ChannelHeader");
		const timelineIndex = source.indexOf("<MuiMessageTimeline");
		const composerIndex = source.indexOf(
			'className="chat-workspace-panel-composer resizable-composer"',
		);

		expect(headerIndex).toBeGreaterThan(0);
		expect(timelineIndex).toBeGreaterThan(headerIndex);
		expect(composerIndex).toBeGreaterThan(timelineIndex);
	});

	test("keeps panel post arrays stable when unrelated panels activate", () => {
		const firstChannelPost = post({ id: "post-1", channel_id: "channel-1" });
		const secondChannelPost = post({ id: "post-2", channel_id: "channel-2" });
		const firstResult = getStablePanelPosts(
			[firstChannelPost, secondChannelPost],
			"channel-1",
			null,
		);
		const secondResult = getStablePanelPosts(
			[firstChannelPost, secondChannelPost],
			"channel-1",
			firstResult.cache,
		);

		expect(secondResult.posts).toBe(firstResult.posts);

		const newFirstChannelPost = post({ id: "post-3", channel_id: "channel-1" });
		const thirdResult = getStablePanelPosts(
			[firstChannelPost, newFirstChannelPost, secondChannelPost],
			"channel-1",
			secondResult.cache,
		);

		expect(thirdResult.posts).not.toBe(secondResult.posts);
		expect(thirdResult.posts).toEqual([firstChannelPost, newFirstChannelPost]);
	});

	test("reserves panel rows for header, timeline, and composer", () => {
		const css = readFileSync("src/mainview/index.css", "utf8");
		const panel = css.match(/\.chat-workspace-panel \{[^}]+\}/)?.[0] ?? "";
		const header =
			css.match(/\.chat-workspace-panel > \.channel-header \{[^}]+\}/)?.[0] ??
			"";
		const timeline =
			css.match(/\.chat-workspace-panel > \.message-scroll \{[^}]+\}/)?.[0] ??
			"";
		const composerWrapper =
			css.match(/\.chat-workspace-panel > \.react-resizable \{[^}]+\}/)?.[0] ??
			"";

		expect(panel).toContain("grid-template-columns: minmax(0, 1fr);");
		expect(panel).toContain("grid-template-rows: auto minmax(0, 1fr) auto;");
		expect(header).toContain("grid-column: 1;");
		expect(header).toContain("grid-row: 1;");
		expect(timeline).toContain("grid-column: 1;");
		expect(timeline).toContain("grid-row: 2;");
		expect(composerWrapper).toContain("grid-column: 1;");
		expect(composerWrapper).toContain("grid-row: 3;");
	});
});
