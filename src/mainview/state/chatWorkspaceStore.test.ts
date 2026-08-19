import { afterEach, describe, expect, test } from "bun:test";
import { chatWorkspaceActions, chatWorkspaceStore } from "./chatWorkspaceStore";

const channelInput = {
	channelId: "channel1",
	teamId: "team1",
	title: "Town Square",
};

function openInitialTab() {
	chatWorkspaceActions.openTab(channelInput);
}

afterEach(() => {
	chatWorkspaceActions.reset();
});

describe("chatWorkspaceStore", () => {
	test("openTab adds a tab and selects it", () => {
		openInitialTab();

		const tabs = Object.values(chatWorkspaceStore.workspace.tabs);
		expect(tabs).toHaveLength(1);
		expect(tabs[0]?.channelId).toBe("channel1");
		expect(chatWorkspaceStore.workspace.activeTabId).toBe(tabs[0]?.id);
	});

	test("closeTab removes the tab and clears layout", () => {
		openInitialTab();
		const tabId = chatWorkspaceStore.workspace.activeTabId ?? "";

		chatWorkspaceActions.closeTab(tabId);

		expect(chatWorkspaceStore.workspace.tabs[tabId]).toBeUndefined();
		expect(chatWorkspaceStore.workspace.layout).toBeNull();
	});

	test("activateTab switches the active tab", () => {
		chatWorkspaceActions.openTab({ ...channelInput, duplicate: true });
		chatWorkspaceActions.openTab({
			...channelInput,
			channelId: "channel2",
			duplicate: true,
		});
		const tabIds = Object.keys(chatWorkspaceStore.workspace.tabs);
		const first = tabIds[0] ?? "";
		const second = tabIds[1] ?? "";

		chatWorkspaceActions.activateTab(first);
		expect(chatWorkspaceStore.workspace.activeTabId).toBe(first);

		chatWorkspaceActions.activateTab(second);
		expect(chatWorkspaceStore.workspace.activeTabId).toBe(second);
	});

	test("view state mutations are isolated per channel", () => {
		chatWorkspaceActions.setDraft("channel1", "hello");
		chatWorkspaceActions.setReplyTarget("channel1", "post1");
		chatWorkspaceActions.setComposerHeight("channel1", 240);

		chatWorkspaceActions.setDraft("channel2", "world");

		expect(chatWorkspaceStore.chatViewStates["channel1"]?.draftMarkdown).toBe(
			"hello",
		);
		expect(chatWorkspaceStore.chatViewStates["channel1"]?.replyTargetId).toBe(
			"post1",
		);
		expect(chatWorkspaceStore.chatViewStates["channel1"]?.composerHeight).toBe(
			240,
		);
		expect(chatWorkspaceStore.chatViewStates["channel2"]?.draftMarkdown).toBe(
			"world",
		);
		expect(chatWorkspaceStore.chatViewStates["channel2"]?.replyTargetId).toBe(
			null,
		);
	});

	test("clearReply and clearEdit reset only the targeted field", () => {
		chatWorkspaceActions.setReplyTarget("channel1", "post1");
		chatWorkspaceActions.setEditTarget("channel1", "post2");
		chatWorkspaceActions.setDraft("channel1", "draft");

		chatWorkspaceActions.clearReply("channel1");
		chatWorkspaceActions.clearEdit("channel1");

		const state = chatWorkspaceStore.chatViewStates["channel1"];
		expect(state?.replyTargetId).toBeNull();
		expect(state?.editTargetId).toBeNull();
		expect(state?.draftMarkdown).toBe("draft");
	});

	test("removeInvalidTabs prunes tabs for unknown channels", () => {
		openInitialTab();

		chatWorkspaceActions.removeInvalidTabs(new Set());

		expect(Object.keys(chatWorkspaceStore.workspace.tabs)).toHaveLength(0);
	});

	test("forgetView removes view state for a channel", () => {
		chatWorkspaceActions.setDraft("channel1", "hello");
		chatWorkspaceActions.setReplyTarget("channel1", "post1");
		chatWorkspaceActions.setDraft("channel2", "world");

		chatWorkspaceActions.forgetView("channel1");

		expect(chatWorkspaceStore.chatViewStates["channel1"]).toBeUndefined();
		expect(chatWorkspaceStore.chatViewStates["channel2"]?.draftMarkdown).toBe(
			"world",
		);
	});

	test("forgetView is a no-op when view state does not exist", () => {
		chatWorkspaceActions.setDraft("channel1", "hello");

		chatWorkspaceActions.forgetView("nonexistent");

		expect(chatWorkspaceStore.chatViewStates["channel1"]?.draftMarkdown).toBe(
			"hello",
		);
	});
});
