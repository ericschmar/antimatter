import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Sidebar", () => {
	test("opens the channel tab action through the tab callback", () => {
		const source = readFileSync(
			new URL("./Sidebar.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain("onClick={() => onOpenChatPanel(channel.id)}");
	});
});
