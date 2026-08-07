import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("ChatWorkspace panel layout", () => {
	test("renders each chat panel as header, timeline, then composer", () => {
		const source = readFileSync(
			"src/mainview/components/ChatWorkspace.tsx",
			"utf8",
		);
		const headerIndex = source.indexOf("<ChannelHeader");
		const timelineIndex = source.indexOf("<MessageTimeline");
		const composerIndex = source.indexOf(
			'className="chat-workspace-panel-composer resizable-composer"',
		);

		expect(headerIndex).toBeGreaterThan(0);
		expect(timelineIndex).toBeGreaterThan(headerIndex);
		expect(composerIndex).toBeGreaterThan(timelineIndex);
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
