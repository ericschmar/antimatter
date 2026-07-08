import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { MessageTimeline } from "./MessageTimeline";
import type { MattermostPost, MattermostUser } from "../types";

const currentUser: MattermostUser = { id: "user-1", username: "sarah" };
const otherUser: MattermostUser = { id: "user-2", username: "alex" };
const post: MattermostPost = {
	channel_id: "channel-1",
	create_at: 1,
	delete_at: 0,
	id: "post-1",
	message: "hello **@sarah**",
	update_at: 1,
	user_id: otherUser.id,
};

const props = {
	channelId: "channel-1",
	currentUserId: currentUser.id,
	loading: false,
	ownMessageIndicatorColor: "#46a758",
	posts: [post],
	resolveImageSrc: async (src: string) => src,
	showOwnMessageIndicators: true,
	showProfilePictures: true,
	typingUsers: [],
	userColors: {},
	userImages: {},
	userStatuses: {},
	users: {
		[currentUser.id]: currentUser,
		[otherUser.id]: otherUser,
	},
	onLoadMore: undefined,
	onOpenAttachment: async () => {},
	onReply: () => {},
	onSetUserColor: () => {},
	onShowMessageContextMenu: () => {},
	onToggleReaction: async () => {},
};

describe("MessageTimeline", () => {
	test("uses the legacy markdown renderer when the new composer flag is off", () => {
		const html = renderToString(<MessageTimeline {...props} useNewComposer={false} />);
		expect(html).toContain("markdown-message");
		expect(html).not.toContain("markdown-message-new");
	});

	test("uses the react-md-editor markdown renderer when the new composer flag is on", () => {
		const html = renderToString(<MessageTimeline {...props} useNewComposer />);
		expect(html).toContain("markdown-message-new");
		expect(html).toContain("wmde-markdown");
	});
});
