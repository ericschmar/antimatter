import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("MainViewApp startup connection effect", () => {
	test("does not rerun when channel selection persists config changes", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain("void connect(config);");
		expect(source).toContain(
			"}, []);\n\n\tuseEffect(() => {\n\t\tvoid electrobun.rpc?.request.getAppUpdateState",
		);
		expect(source).not.toContain("}, [config, connect]);");
	});
});

describe("MainViewApp channel selection", () => {
	test("unarchives channels opened directly or from search", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain(
			"async function selectChannel(channel: MattermostChannel) {",
		);
		expect(source).toContain(
			"\tunarchiveChannel(channel.id);\n\n\t\tconst key = channelHistoryKey",
		);
		expect(source).toContain(
			"async function selectSearchPost(post: MattermostPost) {",
		);
		expect(source).toContain(
			"\t\t\tunarchiveChannel(channel.id);\n\t\t\tconst postList = await api.getPostThread(post.id)",
		);
	});

	test("opens or activates a workspace tab when selecting a channel", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain(
			"const [, setChatWorkspace] = useState(() =>\n\t\tcreateEmptyChatWorkspaceState(),\n\t);",
		);
		expect(source).toContain(
			"\t\tsetChatWorkspace((workspace) =>\n\t\t\topenChatTab(workspace, {\n\t\t\t\tchannelId: channel.id,\n\t\t\t\tteamId: channel.team_id || null,\n\t\t\t\ttitle: channelLabel(channel, stateRef.current.users, currentUser?.id),\n\t\t\t}),\n\t\t);\n\t\tsetSelectedChannelId(channel.id);",
		);
	});
});
