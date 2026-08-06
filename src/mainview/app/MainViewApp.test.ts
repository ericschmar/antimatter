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
			"const [chatWorkspace, setChatWorkspace] = useState(() =>\n\t\tcreateEmptyChatWorkspaceState(),\n\t);\n\tconst activeWorkspaceChannelId = getSelectedChannelId(chatWorkspace);",
		);
		expect(source).toContain(
			"\t\tsetChatWorkspace((workspace) =>\n\t\t\topenChatTab(workspace, {\n\t\t\t\tchannelId: channel.id,\n\t\t\t\tteamId: channel.team_id || null,\n\t\t\t\ttitle: channelLabel(channel, stateRef.current.users, currentUser?.id),\n\t\t\t}),\n\t\t);\n\t\tsetSelectedChannelId(channel.id);",
		);
		expect(source).toContain(
			"const renderedChannelId = activeWorkspaceChannelId ?? selectedChannelId;\n\tconst selectedChannel = renderedChannelId\n\t\t? state.channels[renderedChannelId]\n\t\t: undefined;",
		);
		expect(source).toContain("selectedChannelId={renderedChannelId}");
	});

	test("passes workspace state to the isolated chat workspace proof of concept", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain("chatWorkspace={chatWorkspace}");
	});

	test("syncs Dockview active panel changes to the active workspace tab", () => {
		const mainViewSource = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);
		const chatShellSource = readFileSync(
			new URL("./ChatShell.tsx", import.meta.url),
			"utf8",
		);
		const chatWorkspaceSource = readFileSync(
			new URL("../components/ChatWorkspace.tsx", import.meta.url),
			"utf8",
		);

		expect(mainViewSource).toContain(
			"const handleActivateChatTab = useCallback((tabId: string) => {\n\t\tsetChatWorkspace((workspace) => activateChatTab(workspace, tabId));\n\t}, []);",
		);
		expect(mainViewSource).toContain(
			"onActivateChatTab={handleActivateChatTab}",
		);
		expect(chatShellSource).toContain("onActivateTab={onActivateChatTab}");
		expect(chatWorkspaceSource).toContain(
			"event.api.onDidActivePanelChange(({ panel }) => {\n\t\t\t\t\t\t\tif (panel) onActivateTab(panel.id);\n\t\t\t\t\t\t});",
		);
		expect(chatWorkspaceSource).toContain(
			"onPointerDown={() => workspaceProps.onActivateTab(api.id)}",
		);
		expect(chatWorkspaceSource).toContain(
			"onFocus={() => workspaceProps.onActivateTab(api.id)}",
		);
	});

	test("syncs Dockview panel close events to chat workspace state", () => {
		const mainViewSource = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);
		const chatShellSource = readFileSync(
			new URL("./ChatShell.tsx", import.meta.url),
			"utf8",
		);
		const chatWorkspaceSource = readFileSync(
			new URL("../components/ChatWorkspace.tsx", import.meta.url),
			"utf8",
		);

		expect(mainViewSource).toContain(
			"const handleCloseChatTab = useCallback((tabId: string) => {\n\t\tsetChatWorkspace((workspace) => closeChatTab(workspace, tabId));\n\t}, []);",
		);
		expect(mainViewSource).toContain("onCloseChatTab={handleCloseChatTab}");
		expect(chatShellSource).toContain("onCloseTab={onCloseChatTab}");
		expect(chatWorkspaceSource).toContain(
			"event.api.onDidRemovePanel((panel) => {\n\t\t\t\t\t\t\tonCloseTab(panel.id);\n\t\t\t\t\t\t});",
		);
	});

	test("renders a composer inside each Dockview chat panel", () => {
		const chatShellSource = readFileSync(
			new URL("./ChatShell.tsx", import.meta.url),
			"utf8",
		);
		const chatWorkspaceSource = readFileSync(
			new URL("../components/ChatWorkspace.tsx", import.meta.url),
			"utf8",
		);

		expect(chatShellSource).toContain("composerProps={composerProps}");
		expect(chatWorkspaceSource).toContain(
			'<div className="chat-workspace-panel-composer">',
		);
		expect(chatWorkspaceSource).toContain(
			"<NewMessageComposer {...panelComposerProps} ref={setComposerRef} />",
		);
		expect(chatWorkspaceSource).toContain(
			"<MessageComposer {...panelComposerProps} ref={setComposerRef} />",
		);
	});

	test("stores reply target state by chat channel", () => {
		const mainViewSource = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);
		const chatShellSource = readFileSync(
			new URL("./ChatShell.tsx", import.meta.url),
			"utf8",
		);
		const chatWorkspaceSource = readFileSync(
			new URL("../components/ChatWorkspace.tsx", import.meta.url),
			"utf8",
		);

		expect(mainViewSource).toContain(
			"const [chatViewStates, setChatViewStates] = useState<ChatViewStateByChannel>(",
		);
		expect(mainViewSource).toContain(
			"updateChatViewState(current, post.channel_id",
		);
		expect(mainViewSource).toContain("chatViewStates={chatViewStates}");
		expect(chatShellSource).toContain(
			"chatViewStates[selectedChannelId]?.replyTargetId",
		);
		expect(chatShellSource).toContain(
			"chatViewStates[selectedChannelId]?.editTargetId",
		);
		expect(chatShellSource).toContain(
			"chatViewStates[selectedChannelId]?.draftMarkdown",
		);
		expect(chatWorkspaceSource).toContain("panelState?.replyTargetId");
		expect(chatWorkspaceSource).toContain("panelState?.editTargetId");
		expect(chatWorkspaceSource).toContain("panelState?.draftMarkdown");
		expect(chatWorkspaceSource).toContain(
			"onCancelReply: () => workspaceProps.onCancelReply(params.channelId)",
		);
		expect(chatWorkspaceSource).toContain(
			"workspaceProps.onSetDraftMarkdown(params.channelId, draftMarkdown)",
		);
	});

	test("routes composer shortcuts through the active chat panel ref", () => {
		const chatShellSource = readFileSync(
			new URL("./ChatShell.tsx", import.meta.url),
			"utf8",
		);
		const chatWorkspaceSource = readFileSync(
			new URL("../components/ChatWorkspace.tsx", import.meta.url),
			"utf8",
		);

		expect(chatShellSource).toContain(
			"const panelComposerRefs = useRef(new Map<string, MessageComposerHandle>());",
		);
		expect(chatShellSource).toContain(
			"panelComposerRefs.current.get(selectedChannelId) ??",
		);
		expect(chatShellSource).toContain("composerRef.current");
		expect(chatShellSource).toContain("getActiveComposer()?.attachFiles()");
		expect(chatShellSource).toContain(
			"onComposerRef={registerPanelComposerRef}",
		);
		expect(chatWorkspaceSource).toContain(
			"workspaceProps.onComposerRef(params.channelId, handle)",
		);
		expect(chatWorkspaceSource).toContain(
			"<NewMessageComposer {...panelComposerProps} ref={setComposerRef} />",
		);
		expect(chatWorkspaceSource).toContain(
			"<MessageComposer {...panelComposerProps} ref={setComposerRef} />",
		);
	});
});
