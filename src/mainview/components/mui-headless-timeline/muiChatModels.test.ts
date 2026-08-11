import { beforeEach, describe, expect, test } from "bun:test";
import type { ChatMessage } from "@mui/x-chat/headless";
import type { MattermostPost, MattermostUser } from "../../types";
import type { MuiTimelineContextValue } from "./MuiTimelineContext";
import {
	__resetMuiMessageCache,
	buildMuiTimelineMessages,
} from "./muiChatModels";

function makeUser(id: string): MattermostUser {
	return { id, username: id };
}

function makePost(overrides: Partial<MattermostPost>): MattermostPost {
	return {
		id: "post-1",
		create_at: 1,
		update_at: 1,
		delete_at: 0,
		user_id: "u1",
		channel_id: "channel-1",
		message: "hello",
		...overrides,
	};
}

function makeContext(
	overrides: Partial<MuiTimelineContextValue> = {},
): MuiTimelineContextValue {
	return {
		posts: [],
		channel: undefined,
		channelId: "channel-1",
		currentUser: makeUser("me"),
		currentUserId: "me",
		users: {},
		userColors: {},
		userImages: {},
		userStatuses: {},
		loading: false,
		resolveImageSrc: (src: string) => Promise.resolve(src),
		ownMessageIndicatorColor: "#000",
		showOwnMessageIndicators: true,
		showProfilePictures: true,
		useNewComposer: false,
		typingUsers: [],
		onOpenAttachment: async () => {},
		onShowMessageContextMenu: () => {},
		onSetUserColor: () => {},
		onStartDm: () => {},
		onReply: () => {},
		onToggleReaction: async () => {},
		onVotePoll: async () => {},
		...overrides,
	} as MuiTimelineContextValue;
}

function byId(messages: ChatMessage[]): Record<string, ChatMessage> {
	return Object.fromEntries(messages.map((message) => [message.id, message]));
}

describe("buildMuiTimelineMessages object cache", () => {
	beforeEach(__resetMuiMessageCache);

	test("reuses message objects when surrounding maps are reallocated with same values", () => {
		const u1 = makeUser("u1");
		const p = makePost({ id: "p1", user_id: "u1", message: "hi" });
		const first = buildMuiTimelineMessages(
			[p],
			makeContext({ users: { u1 }, userImages: { u1: "img" } }),
		);
		const second = buildMuiTimelineMessages(
			[p],
			makeContext({ users: { u1 }, userImages: { u1: "img" } }),
		);
		expect(second[0]).toBe(first[0]);
	});

	test("rebuilds only the affected message when one user's image changes", () => {
		const u1 = makeUser("u1");
		const u2 = makeUser("u2");
		const p1 = makePost({ id: "p1", user_id: "u1", message: "a" });
		const p2 = makePost({
			id: "p2",
			user_id: "u2",
			message: "b",
			create_at: 2,
		});
		const first = buildMuiTimelineMessages(
			[p1, p2],
			makeContext({
				users: { u1, u2 },
				userImages: { u1: "img1", u2: "img2" },
			}),
		);
		const firstById = byId(first);
		const second = buildMuiTimelineMessages(
			[p1, p2],
			makeContext({
				users: { u1, u2 },
				userImages: { u1: "img1-changed", u2: "img2" },
			}),
		);
		expect(second.find((message) => message.id === "p1")).not.toBe(
			firstById["p1"],
		);
		expect(second.find((message) => message.id === "p2")).toBe(firstById["p2"]);
	});

	test("reuses existing message objects when a new post is appended (burst)", () => {
		const u1 = makeUser("u1");
		const p1 = makePost({ id: "p1", user_id: "u1", create_at: 1 });
		const ctx = makeContext({ users: { u1 } });
		const first = buildMuiTimelineMessages([p1], ctx);
		const p2 = makePost({ id: "p2", user_id: "u1", create_at: 2 });
		const second = buildMuiTimelineMessages([p1, p2], ctx);
		expect(second.find((message) => message.id === "p1")).toBe(first[0]);
		expect(second.find((message) => message.id === "p2")).toBeDefined();
	});

	test("rebuilds a thread message when a reply is added", () => {
		const u1 = makeUser("u1");
		const root = makePost({ id: "root", user_id: "u1", create_at: 1 });
		const ctx = makeContext({ users: { u1 } });
		const first = buildMuiTimelineMessages([root], ctx);
		const reply = makePost({
			id: "reply",
			root_id: "root",
			user_id: "u1",
			create_at: 2,
		});
		const second = buildMuiTimelineMessages([root, reply], ctx);
		expect(second.find((message) => message.id === "root")).not.toBe(first[0]);
	});

	test("clears the cache when the channel changes", () => {
		const u1 = makeUser("u1");
		const p = makePost({ id: "p1", user_id: "u1" });
		const first = buildMuiTimelineMessages(
			[p],
			makeContext({ channelId: "A", users: { u1 } }),
		);
		const second = buildMuiTimelineMessages(
			[p],
			makeContext({ channelId: "B", users: { u1 } }),
		);
		expect(second[0]).not.toBe(first[0]);
	});
});
