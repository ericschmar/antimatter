import { afterEach, describe, expect, test } from "bun:test";
import {
	chatDataActions,
	chatDataStore,
	initialChatDataState,
} from "./chatDataStore";

afterEach(() => {
	chatDataActions.resetForSignOut();
});

describe("chatDataStore", () => {
	test("tracks the current user and derived id together", () => {
		const user = {
			id: "user1",
			username: "alice",
			email: "",
			first_name: "",
			last_name: "",
			nickname: "",
			is_bot: false,
			delete_at: 0,
		};

		chatDataActions.setCurrentUser(user);

		expect(chatDataStore.currentUser?.id).toBe("user1");
		expect(chatDataStore.currentUserId).toBe("user1");

		chatDataActions.setCurrentUser(null);

		expect(chatDataStore.currentUser).toBeNull();
		expect(chatDataStore.currentUserId).toBe("");
	});

	test("merges user lookups with functional updaters", () => {
		chatDataActions.setUsers({ user1: { id: "user1", username: "alice" } });
		chatDataActions.setUsers((current) => ({
			...current,
			user2: { id: "user2", username: "bob" },
		}));

		expect(Object.keys(chatDataStore.users).sort()).toEqual(["user1", "user2"]);
	});

	test("channels lookup is keyed by id", () => {
		chatDataActions.setChannelsById({
			channel1: { id: "channel1", name: "town-square" } as never,
		});

		expect(chatDataStore.channelsById["channel1"]?.id).toBe("channel1");
	});

	test("status, colors, and images update independently", () => {
		chatDataActions.setUserColors({ user1: "#f00" });
		chatDataActions.setUserImages({ user1: "data:image/png;base64,AAA" });
		chatDataActions.setUserStatuses({
			user1: { user_id: "user1", status: "online" } as never,
		});

		expect(chatDataStore.userColors["user1"]).toBe("#f00");
		expect(chatDataStore.userImages["user1"]).toContain("data:image");
		expect(chatDataStore.userStatuses["user1"]?.status).toBe("online");
	});

	test("tracks per-channel end-of-history signal", () => {
		chatDataActions.setChannelHasMoreHistory("c1", false);
		expect(chatDataStore.hasMoreHistoryByChannel["c1"]).toBe(false);

		chatDataActions.setChannelHasMoreHistory("c1", true);
		expect(chatDataStore.hasMoreHistoryByChannel["c1"]).toBe(true);

		chatDataActions.resetForSignOut();
		expect(chatDataStore.hasMoreHistoryByChannel).toEqual({});
	});

	test("resetForSignOut restores the initial state", () => {
		chatDataActions.setUsers({ user1: { id: "user1", username: "alice" } });
		chatDataActions.setUserColors({ user1: "#f00" });
		chatDataActions.setSettings((current) => ({
			...current,
			theme: "light",
		}));

		chatDataActions.resetForSignOut();

		expect(chatDataStore.users).toEqual(initialChatDataState.users);
		expect(chatDataStore.userColors).toEqual({});
		expect(chatDataStore.settings.theme).toBe(
			initialChatDataState.settings.theme,
		);
	});
});
