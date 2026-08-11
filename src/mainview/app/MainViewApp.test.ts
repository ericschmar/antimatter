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
			"const [chatWorkspace, setChatWorkspace] = useState(() =>\n\t\tcreateChatWorkspaceStateFromTabs(config?.chatWorkspaceTabs),\n\t);\n\tconst chatWorkspaceRef = useRef(chatWorkspace);\n\tchatWorkspaceRef.current = chatWorkspace;\n\tconst activeWorkspaceChannelId = getSelectedChannelId(chatWorkspace);",
		);
		expect(source).toContain(
			"const standaloneChannelId = activeWorkspaceChannelId",
		);
		expect(source).toContain("? null\n\t\t: selectedChannelId;");
		expect(source).toContain(
			"\t\tconst nextWorkspace = openChatTab(chatWorkspaceRef.current, {\n\t\t\tchannelId: channel.id,\n\t\t\tteamId: channel.team_id || null,\n\t\t\ttitle: channelLabel(channel, stateRef.current.users, currentUser?.id),\n\t\t});\n\t\tchatWorkspaceRef.current = nextWorkspace;\n\t\tsetChatWorkspace(nextWorkspace);\n\t\tpersistChatWorkspaceTabs(nextWorkspace, nextConfig);\n\t\tsetSelectedChannelId(channel.id);",
		);
		expect(source).toContain(
			"const renderedChannelId = activeWorkspaceChannelId ?? selectedChannelId;\n\tconst selectedChannel = renderedChannelId\n\t\t? state.channels[renderedChannelId]\n\t\t: undefined;",
		);
		expect(source).toContain(
			"if (fetchedHistory) setChannelMembers(fetchedHistory.members);",
		);
		expect(source).toContain("selectedChannelId={renderedChannelId}");
	});

	test("selects the channel when opening a workspace tab directly", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);
		const openChatPanelBody = source.slice(
			source.indexOf("\tfunction openChatPanel"),
			source.indexOf("\n\tfunction signOut"),
		);

		expect(openChatPanelBody).toContain(
			"selectedChannelRef.current = channel.id;",
		);
		expect(openChatPanelBody).toContain("setSelectedChannelId(channel.id);");
	});

	test("loads channel history on a cache miss when opening a chat tab", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);
		const selectChannelBody = source.slice(
			source.indexOf(
				"async function selectChannel(channel: MattermostChannel)",
			),
			source.indexOf("\n\tasync function selectSearchPost"),
		);

		// Without a cached SWR history, selectChannel must fetch the channel
		// history itself. The standalone SWR fetch is keyed on standaloneChannelId,
		// which is null while a workspace tab is active, so opening a chat tab
		// would otherwise never load prior messages (DMs and new channels alike).
		expect(selectChannelBody).toContain(
			"const fetchedHistory = cachedHistory\n\t\t\t? cachedHistory\n\t\t\t: await loadChannelHistory(api, channel.id, currentUser?.id);",
		);
		expect(selectChannelBody).toContain(
			"void mutateSWR(\n\t\t\tchannelHistoryKey(config.serverUrl, channel.id),\n\t\t\tfetchedHistory,\n\t\t\t{ revalidate: false },\n\t\t);",
		);
		expect(selectChannelBody).toContain("applyChannelHistory(");
		expect(selectChannelBody).toContain(
			"if (fetchedHistory) setChannelMembers(fetchedHistory.members);",
		);
		expect(selectChannelBody).toContain(
			'setStatus(fetchedHistory ? "ready" : "loading");',
		);
		expect(selectChannelBody).toContain(
			"void loadPostReactions(api, Object.values(fetchedHistory.posts));",
		);
	});

	test("persists open workspace tab metadata", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain(
			"chatWorkspaceTabs: getPersistedChatWorkspaceTabs(nextWorkspace)",
		);
		expect(source).toContain(
			"createChatWorkspaceStateFromTabs(config?.chatWorkspaceTabs)",
		);
		expect(source).toContain(
			"persistChatWorkspaceTabs(nextWorkspace);\n\t\t},\n\t\t[persistChatWorkspaceTabs],\n\t);",
		);
	});

	test("passes workspace state to the isolated chat workspace proof of concept", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain("chatWorkspace={chatWorkspace}");
	});

	test("loads every restored workspace panel channel during startup", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain("const restoredWorkspaceChannelIds = new Set(");
		expect(source).toContain("Object.values(chatWorkspaceRef.current.tabs)");
		expect(source).toContain(
			"restoredWorkspaceChannelIds.add(selectedChannel.id);",
		);
		expect(source).toContain("const channelHistories = await Promise.all(");
		expect(source).toContain("posts = Object.assign(");
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
			"const currentWorkspace = chatWorkspaceRef.current;\n\t\t\tconst nextWorkspace = activateChatTab(currentWorkspace, tabId);\n\t\t\tif (nextWorkspace === currentWorkspace) return;",
		);
		expect(mainViewSource).toContain(
			"onActivateChatTab={handleActivateChatTab}",
		);
		expect(chatShellSource).toContain("onActivateTab={onActivateChatTab}");
		expect(chatWorkspaceSource).toContain("event.api.onDidActivePanelChange");
		expect(chatWorkspaceSource).toContain("if (panel) onActivateTab(panel.id)");
		expect(chatWorkspaceSource).toContain(
			"event.api.getPanel(workspace.activeTabId)?.api.setActive();",
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
			"const handleCloseChatTab = useCallback(\n\t\t(tabId: string) => {\n\t\t\tconst nextWorkspace = closeChatTab(chatWorkspaceRef.current, tabId);\n\t\t\tchatWorkspaceRef.current = nextWorkspace;\n\t\t\tsetChatWorkspace(nextWorkspace);\n\t\t\tpersistChatWorkspaceTabs(nextWorkspace);\n\t\t},\n\t\t[persistChatWorkspaceTabs],\n\t);",
		);
		expect(mainViewSource).toContain("onCloseChatTab={handleCloseChatTab}");
		expect(chatShellSource).toContain("onCloseTab={onCloseChatTab}");
		expect(chatWorkspaceSource).toContain("event.api.onDidRemovePanel");
		expect(chatWorkspaceSource).toContain("onCloseTab(panel.id)");
	});

	test("moves split actions from panel buttons to the Dockview tab context menu", () => {
		const chatWorkspaceSource = readFileSync(
			new URL("../components/ChatWorkspace.tsx", import.meta.url),
			"utf8",
		);

		expect(chatWorkspaceSource).toContain(
			"getTabContextMenuItems={({ panel }) => [",
		);
		expect(chatWorkspaceSource).toContain('label: "Split right"');
		expect(chatWorkspaceSource).toContain('label: "Split down"');
		expect(chatWorkspaceSource).toContain('"right",');
		expect(chatWorkspaceSource).toContain('"below",');
		expect(chatWorkspaceSource).not.toContain("chat-workspace-panel-actions");
		expect(chatWorkspaceSource).not.toContain('aria-label="Split chat right"');
		expect(chatWorkspaceSource).not.toContain('aria-label="Split chat down"');
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
			'className="chat-workspace-panel-composer resizable-composer"',
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
			"onCancelReply: () => workspaceProps.onCancelReply(api.id)",
		);
		expect(chatWorkspaceSource).toContain(
			"workspaceProps.onSetDraftMarkdown(api.id, draftMarkdown)",
		);
		expect(mainViewSource).toContain(
			"async function sendMessage(\n\t\tchannelId: string,",
		);
		expect(chatShellSource).toContain(
			"return onSendMessage(selectedChannelId, message, rootId, files)",
		);
		expect(chatWorkspaceSource).toContain(
			"onCancelEdit: () => workspaceProps.onCancelEdit(api.id)",
		);
		expect(chatWorkspaceSource).toContain(
			"workspaceProps.onSendMessage(params.channelId, message, rootId, files)",
		);
	});

	test("routes workspace load more through the panel channel", () => {
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

		expect(mainViewSource).toContain("async function loadMoreMessages(");
		expect(mainViewSource).toContain(
			"channelId = selectedChannelRef.current ?? undefined",
		);
		expect(mainViewSource).toContain(
			"const selectedChannelHistoryKey = channelHistoryKey(\n\t\tconfig?.serverUrl,\n\t\tstandaloneChannelId,\n\t);",
		);
		expect(chatShellSource).toContain(
			"onLoadMore={(channelId) => void onLoadMoreMessages(channelId)}",
		);
		expect(chatWorkspaceSource).toContain(
			"workspaceProps.onLoadMore?.(params.channelId)",
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
			"workspaceProps.onComposerRef(api.id, handle)",
		);
		expect(chatWorkspaceSource).toContain(
			"<NewMessageComposer {...panelComposerProps} ref={setComposerRef} />",
		);
		expect(chatWorkspaceSource).toContain(
			"<MessageComposer {...panelComposerProps} ref={setComposerRef} />",
		);
	});

	test("preserves draft reply and edit state when switching chat tabs", () => {
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
			"const currentWorkspace = chatWorkspaceRef.current;\n\t\t\tconst nextWorkspace = activateChatTab(currentWorkspace, tabId);\n\t\t\tif (nextWorkspace === currentWorkspace) return;",
		);
		expect(chatShellSource).toContain(
			"chatViewStates[selectedChannelId]?.editTargetId",
		);
		expect(chatShellSource).toContain(
			"chatViewStates[selectedChannelId]?.replyTargetId",
		);
		expect(chatShellSource).toContain(
			"chatViewStates[selectedChannelId]?.draftMarkdown",
		);
		expect(chatWorkspaceSource).toContain(
			"const panelState = workspaceProps.chatViewStates[api.id];",
		);
		expect(chatWorkspaceSource).toContain(
			'draftMarkdown: panelState?.draftMarkdown ?? ""',
		);
		expect(chatWorkspaceSource).toContain(
			"editTarget: panelPosts.find((post) => post.id === editTargetId) ?? null",
		);
		expect(chatWorkspaceSource).toContain(
			"replyTarget: panelPosts.find((post) => post.id === replyTargetId) ?? null",
		);
	});
});
