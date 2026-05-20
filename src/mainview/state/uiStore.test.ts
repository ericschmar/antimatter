import { afterEach, describe, expect, test } from "bun:test";
import { uiActions, uiStore } from "./uiStore";

afterEach(() => {
	uiActions.resetForSignOut();
});

describe("uiStore", () => {
	test("tracks transient dialog state", () => {
		uiActions.setCommandOpen(true);
		uiActions.setCreateDmOpen(true);

		expect(uiStore.commandOpen).toBe(true);
		expect(uiStore.createDmOpen).toBe(true);
	});

	test("updates channel notifications with functional updaters", () => {
		uiActions.setChannelNotifications((current) => ({
			...current,
			channel1: { mention: true, unread: true },
		}));
		uiActions.clearChannelNotification("channel1");

		expect(uiStore.channelNotifications).toEqual({});
	});

	test("resets channel-scoped composer state on channel change", () => {
		uiActions.setLoadingHistory(true);
		uiActions.setReplyTarget({
			channel_id: "channel1",
			create_at: 1,
			delete_at: 0,
			id: "post1",
			message: "hello",
			update_at: 1,
			user_id: "user1",
		});

		uiActions.resetForChannelChange();

		expect(uiStore.loadingHistory).toBe(false);
		expect(uiStore.replyTarget).toBeNull();
	});
});
