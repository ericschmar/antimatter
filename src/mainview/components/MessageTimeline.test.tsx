import * as Tooltip from "@radix-ui/react-tooltip";
import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { MessageRow, MessageTimeline } from "./MessageTimeline";
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

	test("renders reactions on reply messages", () => {
		const reply: MattermostPost = {
			...post,
			id: "reply-1",
			message: "reply",
			metadata: {
				reactions: [
					{
						emoji_name: "thumbsup",
						post_id: "reply-1",
						user_id: currentUser.id,
					},
				],
			},
			root_id: post.id,
		};

		const html = renderToString(
			<Tooltip.Provider>
				<MessageTimeline {...props} posts={[post, reply]} useNewComposer={false} />
			</Tooltip.Provider>,
		);

		expect(html).toContain("👍");
		expect(html).toContain("@sarah reacted with 👍");
	});

	test("rerenders when reply reactions change", () => {
		const reply: MattermostPost = {
			...post,
			id: "reply-1",
			message: "reply",
			root_id: post.id,
		};
		const replyWithReaction: MattermostPost = {
			...reply,
			metadata: {
				reactions: [
					{
						emoji_name: "thumbsup",
						post_id: "reply-1",
						user_id: currentUser.id,
					},
				],
			},
		};
		const compare = (MessageRow as unknown as { compare: (prevProps: Record<string, unknown>, nextProps: Record<string, unknown>) => boolean }).compare;
		const rowProps = {
			currentUserId: currentUser.id,
			post,
			replies: [reply],
			resolveImageSrc: props.resolveImageSrc,
			showOwnMessageIndicators: true,
			showProfilePictures: true,
			useNewComposer: false,
			userColor: undefined,
			userColors: {},
			userImages: {},
			userStatuses: {},
			users: props.users,
			onOpenAttachment: props.onOpenAttachment,
			onReply: props.onReply,
			onSetUserColor: props.onSetUserColor,
			onShowMessageContextMenu: props.onShowMessageContextMenu,
			onToggleReaction: props.onToggleReaction,
		};

		expect(compare(rowProps, { ...rowProps, replies: [replyWithReaction] })).toBe(false);
	});
});
