import { describe, expect, test } from "bun:test";
import {
	activateChatTab,
	closeChatTab,
	createChatWorkspaceStateFromTabs,
	createEmptyChatWorkspaceState,
	getChannelTabId,
	getPersistedChatWorkspaceTabs,
	getSelectedChannelId,
	openChatTab,
	removeInvalidChatTabs,
	updateChatViewState,
	updateChatWorkspaceLayout,
} from "./chatWorkspace";

const layout = {
	grid: {
		root: {
			type: "leaf",
			data: { views: ["chat-panel-1"], activeView: "chat-panel-1" },
		},
		height: 800,
		width: 1200,
		orientation: "HORIZONTAL",
	},
	panels: {
		"chat-panel-1": {
			id: "chat-panel-1",
			contentComponent: "chat",
			tabComponent: "default",
			title: "Town Square",
			params: {},
		},
	},
};

describe("chatWorkspace", () => {
	test("opens a new tab instance and derives the selected channel", () => {
		const workspace = openChatTab(createEmptyChatWorkspaceState(), {
			channelId: "channel-1",
			teamId: "team-1",
			title: "Town Square",
		});

		expect(workspace.activeTabId).toBe("chat-panel-1");
		expect(getSelectedChannelId(workspace)).toBe("channel-1");
		expect(workspace.tabs["chat-panel-1"]).toEqual({
			id: "chat-panel-1",
			channelId: "channel-1",
			teamId: "team-1",
			title: "Town Square",
		});
	});

	test("activates an existing tab", () => {
		const workspace = openChatTab(
			openChatTab(createEmptyChatWorkspaceState(), {
				channelId: "channel-1",
				teamId: "team-1",
				title: "Town Square",
			}),
			{
				channelId: "channel-2",
				teamId: "team-1",
				title: "Off-Topic",
			},
		);
		const activated = activateChatTab(workspace, "chat-panel-1");

		expect(activated.activeTabId).toBe("chat-panel-1");
		expect(getSelectedChannelId(activated)).toBe("channel-1");
	});

	test("focuses the existing channel tab by default", () => {
		const workspace = openChatTab(createEmptyChatWorkspaceState(), {
			channelId: "channel-1",
			teamId: "team-1",
			title: "Town Square",
		});
		const reopened = openChatTab(workspace, {
			channelId: "channel-1",
			teamId: "team-2",
			title: "Renamed",
		});

		expect(Object.keys(reopened.tabs)).toEqual(["chat-panel-1"]);
		expect(reopened.tabs["chat-panel-1"]?.teamId).toBe("team-1");
		expect(reopened.tabs["chat-panel-1"]?.title).toBe("Town Square");
	});

	test("opens duplicate channel panels when requested", () => {
		const workspace = openChatTab(createEmptyChatWorkspaceState(), {
			channelId: "channel-1",
			teamId: "team-1",
			title: "Town Square",
		});
		const duplicated = openChatTab(workspace, {
			channelId: "channel-1",
			teamId: "team-1",
			title: "Town Square",
			duplicate: true,
		});

		expect(Object.keys(duplicated.tabs)).toEqual([
			"chat-panel-1",
			"chat-panel-2",
		]);
		expect(duplicated.activeTabId).toBe("chat-panel-2");
		expect(duplicated.tabs["chat-panel-2"]?.channelId).toBe("channel-1");
	});

	test("records split placement for duplicate panels and clears stale layout", () => {
		const workspace = updateChatWorkspaceLayout(
			openChatTab(createEmptyChatWorkspaceState(), {
				channelId: "channel-1",
				teamId: "team-1",
				title: "Town Square",
			}),
			layout,
		);
		const duplicated = openChatTab(workspace, {
			channelId: "channel-1",
			teamId: "team-1",
			title: "Town Square",
			duplicate: true,
			position: {
				referenceTabId: "chat-panel-1",
				placement: "right",
			},
		});

		expect(duplicated.layout).toBeNull();
		expect(duplicated.tabs["chat-panel-2"]?.position).toEqual({
			referenceTabId: "chat-panel-1",
			placement: "right",
		});
	});

	test("keeps legacy channel tab ids for restored workspaces", () => {
		const workspace = createChatWorkspaceStateFromTabs({
			version: 1,
			activeTabId: "channel:channel-1",
			tabs: {
				[getChannelTabId("channel-1")]: {
					id: getChannelTabId("channel-1"),
					channelId: "channel-1",
					teamId: "team-1",
					title: "Town Square",
				},
			},
		});
		const duplicated = openChatTab(workspace, {
			channelId: "channel-1",
			teamId: "team-1",
			title: "Town Square",
			duplicate: true,
		});

		expect(workspace.activeTabId).toBe("channel:channel-1");
		expect(duplicated.activeTabId).toBe("chat-panel-1");
	});

	test("closes an inactive tab without changing the active tab", () => {
		const workspace = openChatTab(
			openChatTab(createEmptyChatWorkspaceState(), {
				channelId: "channel-1",
				teamId: "team-1",
				title: "Town Square",
			}),
			{
				channelId: "channel-2",
				teamId: "team-1",
				title: "Off-Topic",
			},
		);
		const closed = closeChatTab(workspace, "chat-panel-1");

		expect(closed.activeTabId).toBe("chat-panel-2");
		expect(Object.keys(closed.tabs)).toEqual(["chat-panel-2"]);
	});

	test("closes the active tab and chooses the next active tab", () => {
		const workspace = openChatTab(
			openChatTab(createEmptyChatWorkspaceState(), {
				channelId: "channel-1",
				teamId: "team-1",
				title: "Town Square",
			}),
			{
				channelId: "channel-2",
				teamId: "team-1",
				title: "Off-Topic",
			},
		);
		const closed = closeChatTab(workspace, "chat-panel-2");

		expect(closed.activeTabId).toBe("chat-panel-1");
		expect(getSelectedChannelId(closed)).toBe("channel-1");
	});

	test("removes invalid restored tabs and repairs missing active tab", () => {
		const workspace = {
			...openChatTab(
				openChatTab(createEmptyChatWorkspaceState(), {
					channelId: "channel-1",
					teamId: "team-1",
					title: "Town Square",
				}),
				{
					channelId: "channel-2",
					teamId: "team-1",
					title: "Off-Topic",
				},
			),
			activeTabId: "missing-tab",
		};
		const restored = removeInvalidChatTabs(workspace, new Set(["channel-1"]));

		expect(Object.keys(restored.tabs)).toEqual(["chat-panel-1"]);
		expect(restored.activeTabId).toBe("chat-panel-1");
		expect(getSelectedChannelId(restored)).toBe("channel-1");
	});

	test("serializes and restores open tab metadata with layout", () => {
		const workspace = updateChatWorkspaceLayout(
			activateChatTab(
				openChatTab(
					openChatTab(createEmptyChatWorkspaceState(), {
						channelId: "channel-1",
						teamId: "team-1",
						title: "Town Square",
					}),
					{
						channelId: "channel-2",
						teamId: "team-1",
						title: "Off-Topic",
					},
				),
				"chat-panel-1",
			),
			layout,
		);

		const persistedTabs = getPersistedChatWorkspaceTabs(workspace);
		const restored = createChatWorkspaceStateFromTabs(persistedTabs);

		expect(restored).toEqual(workspace);
		expect(persistedTabs).toEqual({
			version: 1,
			activeTabId: "chat-panel-1",
			tabs: workspace.tabs,
			layout,
		});
	});

	test("repairs invalid restored active tab metadata", () => {
		const workspace = createChatWorkspaceStateFromTabs({
			version: 1,
			activeTabId: "missing-tab",
			tabs: {
				"chat-panel-1": {
					id: "chat-panel-1",
					channelId: "channel-1",
					teamId: "team-1",
					title: "Town Square",
				},
			},
		});

		expect(workspace.activeTabId).toBe("chat-panel-1");
		expect(getSelectedChannelId(workspace)).toBe("channel-1");
	});

	test("updates per-panel chat view state independently", () => {
		const stateByPanel = updateChatViewState({}, "chat-panel-1", (state) => ({
			...state,
			draftMarkdown: "draft one",
			replyTargetId: "post-1",
			composerHeight: 140,
		}));
		const updated = updateChatViewState(
			stateByPanel,
			"chat-panel-2",
			(state) => ({
				...state,
				draftMarkdown: "draft two",
				editTargetId: "post-2",
				composerHeight: 220,
			}),
		);

		expect(updated["chat-panel-1"]).toEqual({
			draftMarkdown: "draft one",
			replyTargetId: "post-1",
			editTargetId: null,
			composerHeight: 140,
		});
		expect(updated["chat-panel-2"]).toEqual({
			draftMarkdown: "draft two",
			replyTargetId: null,
			editTargetId: "post-2",
			composerHeight: 220,
		});
	});
});
