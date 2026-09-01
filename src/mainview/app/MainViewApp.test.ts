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

	test("opens a reusable temporary workspace tab when selecting a channel", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain(
			"const chatWorkspace = useSnapshot(chatWorkspaceStore).workspace;",
		);
		expect(source).toContain(
			"const standaloneChannelId = activeWorkspaceChannelId",
		);
		expect(source).toContain("? null\n\t\t: selectedChannelId;");
		expect(source).toContain(
			"\t\tconst nextWorkspace = openChatTab(chatWorkspaceStore.workspace, {\n\t\t\tchannelId: channel.id,\n\t\t\tteamId: channel.team_id || null,\n\t\t\ttitle: channelLabel(channel, stateRef.current.users, currentUser?.id),\n\t\t\ttemporary: true,\n\t\t});\n\t\tchatWorkspaceActions.replaceWorkspace(nextWorkspace);\n\t\tpersistChatWorkspaceTabs(nextWorkspace, nextConfig);\n\t\tsetSelectedChannelId(channel.id);",
		);
		expect(source).toContain(
			"const selectedChannel = renderedChannelId\n\t\t? state.channels[renderedChannelId]\n\t\t: undefined;",
		);
		expect(source).toContain("setChannelMembers(history.members);");
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
		expect(openChatPanelBody).toContain(
			"if (!getSelectedChannelId(chatWorkspaceStore.workspace)) {\n\t\t\tsetSelectedChannelId(channel.id);\n\t\t}",
		);
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
			"if (!cachedHistory) {\n\t\t\tapplyFetchedHistory(\n\t\t\t\tawait loadChannelHistory(api, channel.id, currentUser?.id),\n\t\t\t);\n\t\t\treturn;\n\t\t}",
		);
		expect(selectChannelBody).toContain(
			"void mutateSWR(channelHistoryKey(config.serverUrl, channel.id), history, {\n\t\t\t\trevalidate: false,\n\t\t\t});",
		);
		expect(selectChannelBody).toContain("applyChannelHistory(");
		expect(selectChannelBody).toContain("setChannelMembers(history.members);");
		expect(selectChannelBody).toContain('setStatus("ready");');
		expect(selectChannelBody).toContain(
			"void loadPostReactions(api, postsNeedingReactions);",
		);
	});

	test("refreshes a cached channel history in the background when opening a chat tab", () => {
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

		// Cached histories only receive posts that arrived while the channel
		// was selected (see useMainViewEvents), so serving the cache alone
		// would leave a tabbed channel without messages that arrived while
		// another channel was selected. The cache renders instantly; the
		// background fetch catches the channel up.
		expect(selectChannelBody).toContain("applyFetchedHistory(cachedHistory);");
		expect(selectChannelBody).toContain(
			"void loadChannelHistory(api, channel.id, currentUser?.id)\n\t\t\t.then(applyFetchedHistory)\n\t\t\t.catch(() => undefined);",
		);
		// Only posts without reactions (in history or already in state) are
		// fetched, so the background refresh must not refetch every reaction.
		expect(selectChannelBody).toContain(
			"const postsNeedingReactions = Object.values(history.posts).filter(",
		);
	});

	test("refreshes every open chat tab's history after a websocket reconnect", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);
		const refreshBody = source.slice(
			source.indexOf("const refreshAfterReconnect = useCallback("),
			source.indexOf("useEffect(() => {\n\t\tif (!api || standaloneChannelId"),
		);

		// While a workspace tab is active nothing reads the mutated history
		// cache, so a reconnect refresh must apply the history to state itself
		// and must cover the open tabs' channels, not just the selected one.
		expect(refreshBody).toContain(
			"setState((current) => applyChannelHistory(current, history));",
		);
		expect(refreshBody).toContain(
			"Object.values(chatWorkspaceStore.workspace.tabs)",
		);
		expect(refreshBody).toContain(
			"applyChannelHistory(current, history, false)",
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

	test("hydrates the workspace store from persisted config on mount", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain(
			"chatWorkspaceActions.replaceWorkspace(\n\t\t\tcreateChatWorkspaceStateFromTabs(config?.chatWorkspaceTabs),\n\t\t);",
		);
	});

	test("reads workspace state from the shared store, not from props", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		// The workspace store (hydrated on mount) owns workspace + view state;
		// MainViewApp no longer drills chatWorkspace/chatViewStates into ChatShell.
		expect(source).toContain(
			"const chatWorkspace = useSnapshot(chatWorkspaceStore).workspace;",
		);
		expect(source).not.toContain("chatWorkspace={chatWorkspace}");
		expect(source).not.toContain("chatViewStates={chatViewStates}");
	});

	test("loads every restored workspace panel channel during startup", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain("const restoredWorkspaceChannelIds = new Set(");
		expect(source).toContain(
			"Object.values(chatWorkspaceStore.workspace.tabs)",
		);
		expect(source).toContain(
			"restoredWorkspaceChannelIds.add(selectedChannel.id);",
		);
		expect(source).toContain("const channelHistories = await Promise.all(");
		expect(source).toContain("posts = Object.assign(");
	});

	test("launches to the empty screen instead of the previous channel when no tabs were restored", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);
		const connectBody = source.slice(
			source.indexOf("async (nextConfig: MattermostConfig)"),
			source.indexOf("const passwordLogin = useCallback("),
		);

		// The empty select-a-conversation screen is the default whenever
		// nothing is selected: connect must derive the standalone selection
		// from the restored workspace tabs only. Falling back to the persisted
		// lastChannelId (or the first channel) resurrects the chat the user
		// closed before quitting.
		expect(connectBody).toContain(
			"const restoredChannelId = getSelectedChannelId(\n\t\t\t\t\t\tchatWorkspaceStore.workspace,\n\t\t\t\t\t);",
		);
		expect(connectBody).toContain(
			"selectedChannel = restoredChannelId\n\t\t\t\t\t\t? channels.find((channel) => channel.id === restoredChannelId)\n\t\t\t\t\t\t: undefined;",
		);
		expect(connectBody).not.toContain(
			"channel.id === normalizedConfig.lastChannelId",
		);
		expect(connectBody).not.toContain("?? preferredFirstChannel(channels)");
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
			"const handleActivateChatTab = useCallback((tabId: string) => {\n\t\tconst currentWorkspace = chatWorkspaceStore.workspace;\n\t\tconst nextWorkspace = activateChatTab(currentWorkspace, tabId);\n\t\tif (nextWorkspace === currentWorkspace) return;",
		);
		expect(mainViewSource).not.toContain(
			"persistChatWorkspaceTabs(nextWorkspace);\n\t}, []);",
		);
		expect(mainViewSource).toContain(
			"if (areChatWorkspaceLayoutsEqual(currentWorkspace.layout, layout)) return;",
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
		expect(chatWorkspaceSource).not.toContain("onPointerDown=");
		expect(chatWorkspaceSource).not.toContain("onFocus=");
	});

	test("clears the channel's unread flag when its chat tab is activated", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		// Posts that arrived while another tab was focused leave an unread
		// flag; focusing the tab shows the channel, so the badge is stale.
		expect(source).toContain(
			"const activatedChannelId = nextWorkspace.tabs[tabId]?.channelId;\n\t\tif (activatedChannelId)\n\t\t\tuiActions.clearChannelNotification(activatedChannelId);",
		);
	});

	test("does not re-flag the rendered channel unread after a reconnect", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);
		const refreshBody = source.slice(
			source.indexOf("const refreshAfterReconnect = useCallback("),
			source.indexOf("useEffect(() => {\n\t\tif (!api || standaloneChannelId"),
		);

		// The reconnect unread filter must exclude the workspace's active tab
		// channel, not just the (possibly stale) standalone selection.
		expect(refreshBody).toContain(
			"const renderedChannelId = getRenderedChannelId(\n\t\t\t\tchatWorkspaceStore.workspace,\n\t\t\t\tselectedChannelId,\n\t\t\t);",
		);
		expect(refreshBody).toContain(
			"if (channel.id === renderedChannelId) return false;",
		);
		expect(refreshBody).not.toContain(
			"if (channel.id === selectedChannelId) return false;",
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
			"const handleCloseChatTab = useCallback(\n\t\t(tabId: string) => {\n\t\t\tconst closedTab = chatWorkspaceStore.workspace.tabs[tabId];\n\t\t\tconst nextWorkspace = closeChatTab(chatWorkspaceStore.workspace, tabId);\n\t\t\tchatWorkspaceActions.replaceWorkspace(nextWorkspace);\n\t\t\tpersistChatWorkspaceTabs(nextWorkspace);",
		);
		expect(mainViewSource).toContain(
			"if (closedTab && !nextWorkspace.activeTabId) {\n\t\t\t\tsetSelectedChannelId(null);\n\t\t\t}",
		);
		expect(mainViewSource).toContain("[persistChatWorkspaceTabs],\n\t);");
		expect(mainViewSource).toContain("onCloseChatTab={handleCloseChatTab}");
		expect(chatShellSource).toContain("onCloseTab={onCloseChatTab}");
		expect(chatWorkspaceSource).toContain("event.api.onDidRemovePanel");
		expect(chatWorkspaceSource).toContain("onCloseTab(panel.id)");
	});

	test("evicts posts and SWR cache for channels closed by the last referencing tab", () => {
		const mainViewSource = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(mainViewSource).toContain("evictInactiveChannelPosts(current, remainingChannelIds)");
		expect(mainViewSource).toContain("chatWorkspaceActions.forgetView(closedTab.channelId)");
		expect(mainViewSource).toContain("swrCache.delete(unstable_serialize(key))");
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
			"chatWorkspaceActions.setEditTarget(post.channel_id, post.id)",
		);
		expect(mainViewSource).toContain(
			"chatWorkspaceActions.setReplyTarget(viewId, post.id)",
		);
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
			"const currentWorkspace = chatWorkspaceStore.workspace;\n\t\tconst nextWorkspace = activateChatTab(currentWorkspace, tabId);\n\t\tif (nextWorkspace === currentWorkspace) return;",
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
			"const panelState = chatViewStates[api.id];",
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

describe("MainViewApp auth screen saved connection", () => {
	test("passes the saved config to the auth screen when env config is absent", () => {
		const source = readFileSync(
			new URL("./MainViewApp.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain(
			'\t\t\t\tdefaultConfig={envConfig ?? config}\n\t\t\t\tdefaultConfigSource={envConfig ? "env" : "saved"}',
		);
	});
});
