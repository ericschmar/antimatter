import { describe, expect, test } from "bun:test";
import {
	activateChatTab,
	closeChatTab,
	createChatWorkspaceStateFromTabs,
	createEmptyChatWorkspaceState,
	getChatTabId,
	getPersistedChatWorkspaceTabs,
	getSelectedChannelId,
	openChatTab,
	removeInvalidChatTabs,
	updateChatViewState,
} from "./chatWorkspace";

describe("chatWorkspace", () => {
	test("opens a new tab and derives the selected channel", () => {
		const workspace = openChatTab(createEmptyChatWorkspaceState(), {
			channelId: "channel-1",
			teamId: "team-1",
			title: "Town Square",
		});

		expect(workspace.activeTabId).toBe("channel:channel-1");
		expect(getSelectedChannelId(workspace)).toBe("channel-1");
		expect(workspace.tabs["channel:channel-1"]).toEqual({
			id: "channel:channel-1",
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
		const activated = activateChatTab(workspace, getChatTabId("channel-1"));

		expect(activated.activeTabId).toBe("channel:channel-1");
		expect(getSelectedChannelId(activated)).toBe("channel-1");
	});

	test("does not duplicate tabs for the same channel", () => {
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

		expect(Object.keys(reopened.tabs)).toEqual(["channel:channel-1"]);
		expect(reopened.tabs["channel:channel-1"]?.teamId).toBe("team-1");
		expect(reopened.tabs["channel:channel-1"]?.title).toBe("Town Square");
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
		const closed = closeChatTab(workspace, getChatTabId("channel-1"));

		expect(closed.activeTabId).toBe("channel:channel-2");
		expect(Object.keys(closed.tabs)).toEqual(["channel:channel-2"]);
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
		const closed = closeChatTab(workspace, getChatTabId("channel-2"));

		expect(closed.activeTabId).toBe("channel:channel-1");
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

		expect(Object.keys(restored.tabs)).toEqual(["channel:channel-1"]);
		expect(restored.activeTabId).toBe("channel:channel-1");
		expect(getSelectedChannelId(restored)).toBe("channel-1");
	});

	test("serializes and restores open tab metadata", () => {
		const workspace = activateChatTab(
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
			getChatTabId("channel-1"),
		);

		const persistedTabs = getPersistedChatWorkspaceTabs(workspace);
		const restored = createChatWorkspaceStateFromTabs(persistedTabs);

		expect(restored).toEqual({
			...workspace,
			layout: null,
		});
		expect(persistedTabs).toEqual({
			version: 1,
			activeTabId: "channel:channel-1",
			tabs: workspace.tabs,
		});
	});

	test("repairs invalid restored active tab metadata", () => {
		const workspace = createChatWorkspaceStateFromTabs({
			version: 1,
			activeTabId: "missing-tab",
			tabs: {
				[getChatTabId("channel-1")]: {
					id: getChatTabId("channel-1"),
					channelId: "channel-1",
					teamId: "team-1",
					title: "Town Square",
				},
			},
		});

		expect(workspace.activeTabId).toBe("channel:channel-1");
		expect(getSelectedChannelId(workspace)).toBe("channel-1");
	});

	test("updates per-channel chat view state independently", () => {
		const stateByChannel = updateChatViewState({}, "channel-1", (state) => ({
			...state,
			draftMarkdown: "draft one",
			replyTargetId: "post-1",
		}));
		const updated = updateChatViewState(
			stateByChannel,
			"channel-2",
			(state) => ({
				...state,
				draftMarkdown: "draft two",
				editTargetId: "post-2",
			}),
		);

		expect(updated["channel-1"]).toEqual({
			draftMarkdown: "draft one",
			replyTargetId: "post-1",
			editTargetId: null,
		});
		expect(updated["channel-2"]).toEqual({
			draftMarkdown: "draft two",
			replyTargetId: null,
			editTargetId: "post-2",
		});
	});
});
