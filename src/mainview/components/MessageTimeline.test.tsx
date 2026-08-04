import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToString } from "react-dom/server";

mock.module("@tanstack/react-virtual", () => ({
	useVirtualizer: ({
		count,
		estimateSize,
		getItemKey,
	}: {
		count: number;
		estimateSize: (index: number) => number;
		getItemKey: (index: number) => string;
	}) => ({
		getTotalSize: () =>
			Array.from({ length: count }).reduce<number>(
				(total, _, index) => total + estimateSize(index),
				0,
			),
		getVirtualItems: () =>
			Array.from({ length: count }).map((_, index) => ({
				index,
				key: getItemKey(index),
				start: Array.from({ length: index }).reduce<number>(
					(total, _unused, previousIndex) =>
						total + estimateSize(previousIndex),
					0,
				),
			})),
		measure: () => {},
		measureElement: () => {},
		scrollToIndex: () => {},
	}),
}));

import { POLL_POST_TYPE } from "../mattermostApi";
import type { MattermostPost, MattermostUser } from "../types";
import { MessageRow, MessageTimeline } from "./MessageTimeline";

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
	onStartDm: () => {},
	onShowMessageContextMenu: () => {},
	onToggleReaction: async () => {},
	onVotePoll: async () => {},
};

describe("MessageTimeline", () => {
	test("renders timeline rows inside the virtualized container", () => {
		const html = renderToString(
			<MessageTimeline {...props} useNewComposer={false} />,
		);

		expect(html).toContain("message-virtualizer");
		expect(html).toContain("date-divider");
		expect(html).toContain("hello");
	});

	test("uses the legacy markdown renderer when the new composer flag is off", () => {
		const html = renderToString(
			<MessageTimeline {...props} useNewComposer={false} />,
		);
		expect(html).toContain("markdown-message");
		expect(html).not.toContain("markdown-message-new");
	});

	test("uses the react-md-editor markdown renderer when the new composer flag is on", () => {
		const html = renderToString(<MessageTimeline {...props} useNewComposer />);
		expect(html).toContain("markdown-message-new");
		expect(html).toContain("wmde-markdown");
	});

	test("renders Start DM as an enabled user menu item", () => {
		const source = readFileSync(
			new URL("./MessageTimeline.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain("Start DM");
		expect(source).not.toContain(
			'<DropdownMenu.Item className="dropdown-item" disabled>',
		);
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
				<MessageTimeline
					{...props}
					posts={[post, reply]}
					useNewComposer={false}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain("👍");
		expect(html).toContain("@sarah reacted with 👍");
	});

	test("renders deleted top-level messages as deleted without stale content or controls", () => {
		const deletedPost: MattermostPost = {
			...post,
			delete_at: 123,
			message: "stale deleted body",
			metadata: {
				files: [
					{
						id: "file-1",
						mime_type: "image/png",
						name: "stale.png",
					},
				],
				reactions: [
					{
						emoji_name: "thumbsup",
						post_id: post.id,
						user_id: currentUser.id,
					},
				],
			},
		};

		const html = renderToString(
			<Tooltip.Provider>
				<MessageTimeline
					{...props}
					posts={[deletedPost]}
					useNewComposer={false}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain("(deleted)");
		expect(html).not.toContain("stale deleted body");
		expect(html).not.toContain("stale.png");
		expect(html).not.toContain("👍");
		expect(html).not.toContain('aria-label="Reply"');
		expect(html).not.toContain('aria-label="Add reaction"');
	});

	test("renders deleted replies as deleted without stale content or controls", () => {
		const reply: MattermostPost = {
			...post,
			delete_at: 123,
			id: "reply-1",
			message: "stale reply body",
			metadata: {
				files: [
					{
						id: "file-1",
						mime_type: "image/png",
						name: "stale-reply.png",
					},
				],
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
				<MessageTimeline
					{...props}
					posts={[post, reply]}
					useNewComposer={false}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain("(deleted)");
		expect(html).not.toContain("stale reply body");
		expect(html).not.toContain("stale-reply.png");
		expect(html).not.toContain("👍");
		expect(html).not.toContain("reply-message-reply-add");
		expect(html).not.toContain("reply-reaction-add");
	});

	test("renders poll posts with options", () => {
		const pollPost: MattermostPost = {
			...post,
			id: "poll-1",
			message: "📊 Poll: Lunch?",
			type: POLL_POST_TYPE,
			props: {
				poll: {
					question: "Lunch?",
					options: [
						{ id: "option-1", text: "Pizza" },
						{ id: "option-2", text: "Sushi" },
					],
					votes: { "user-3": "option-1" },
				},
			},
		};

		const html = renderToString(
			<Tooltip.Provider>
				<MessageTimeline {...props} posts={[pollPost]} useNewComposer={false} />
			</Tooltip.Provider>,
		);

		expect(html).toContain("Lunch?");
		expect(html).toContain("Pizza");
		expect(html).toContain("Sushi");
		expect(html).toContain("1 vote");
	});

	test("renders poll posts with attachments and reactions", () => {
		const pollPost: MattermostPost = {
			...post,
			id: "poll-1",
			message: "📊 Poll: Lunch?",
			metadata: {
				files: [
					{
						id: "file-1",
						mime_type: "application/pdf",
						name: "menu.pdf",
					},
				],
				reactions: [
					{
						emoji_name: "thumbsup",
						post_id: "poll-1",
						user_id: currentUser.id,
					},
				],
			},
			props: {
				poll: {
					question: "Lunch?",
					options: [
						{ id: "option-1", text: "Pizza" },
						{ id: "option-2", text: "Sushi" },
					],
					votes: {},
				},
			},
			type: POLL_POST_TYPE,
		};

		const html = renderToString(
			<Tooltip.Provider>
				<MessageTimeline {...props} posts={[pollPost]} useNewComposer={false} />
			</Tooltip.Provider>,
		);

		expect(html).toContain("Lunch?");
		expect(html).toContain("menu.pdf");
		expect(html).toContain("👍");
		expect(html).toContain("@sarah reacted with 👍");
	});

	test("renders deleted poll posts as deleted without options", () => {
		const deletedPollPost: MattermostPost = {
			...post,
			delete_at: 123,
			id: "poll-1",
			message: "📊 Poll: Lunch?",
			type: POLL_POST_TYPE,
			props: {
				poll: {
					question: "Lunch?",
					options: [
						{ id: "option-1", text: "Pizza" },
						{ id: "option-2", text: "Sushi" },
					],
					votes: {},
				},
			},
		};

		const html = renderToString(
			<Tooltip.Provider>
				<MessageTimeline
					{...props}
					posts={[deletedPollPost]}
					useNewComposer={false}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain("(deleted)");
		expect(html).not.toContain("Pizza");
		expect(html).not.toContain("Sushi");
	});

	test("rerenders when a post is deleted", () => {
		const compare = (
			MessageRow as unknown as {
				compare: (
					prevProps: Record<string, unknown>,
					nextProps: Record<string, unknown>,
				) => boolean;
			}
		).compare;
		const rowProps = {
			currentUserId: currentUser.id,
			post,
			replies: [],
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

		expect(
			compare(rowProps, { ...rowProps, post: { ...post, delete_at: 123 } }),
		).toBe(false);
	});

	test("rerenders when a reply is deleted", () => {
		const reply: MattermostPost = {
			...post,
			id: "reply-1",
			message: "reply",
			root_id: post.id,
		};
		const compare = (
			MessageRow as unknown as {
				compare: (
					prevProps: Record<string, unknown>,
					nextProps: Record<string, unknown>,
				) => boolean;
			}
		).compare;
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

		expect(
			compare(rowProps, {
				...rowProps,
				replies: [{ ...reply, delete_at: 123 }],
			}),
		).toBe(false);
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
		const compare = (
			MessageRow as unknown as {
				compare: (
					prevProps: Record<string, unknown>,
					nextProps: Record<string, unknown>,
				) => boolean;
			}
		).compare;
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

		expect(
			compare(rowProps, { ...rowProps, replies: [replyWithReaction] }),
		).toBe(false);
	});

	test("rerenders when poll votes change", () => {
		const pollPost: MattermostPost = {
			...post,
			id: "poll-1",
			message: "📊 Poll: Lunch?",
			type: POLL_POST_TYPE,
			props: {
				poll: {
					question: "Lunch?",
					options: [
						{ id: "option-1", text: "Pizza" },
						{ id: "option-2", text: "Sushi" },
					],
					votes: {},
				},
			},
		};
		const compare = (
			MessageRow as unknown as {
				compare: (
					prevProps: Record<string, unknown>,
					nextProps: Record<string, unknown>,
				) => boolean;
			}
		).compare;
		const rowProps = {
			currentUserId: currentUser.id,
			post: pollPost,
			replies: [],
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
			onVotePoll: () => {},
		};

		expect(
			compare(rowProps, {
				...rowProps,
				post: {
					...pollPost,
					props: {
						poll: {
							...pollPost.props?.poll,
							votes: { [currentUser.id]: "option-1" },
						},
					},
				},
			}),
		).toBe(false);
	});

	test("styles current-user reactions with an outline instead of a pale fill", () => {
		const css = readFileSync(
			new URL("./MessageTimeline.css", import.meta.url),
			"utf8",
		);
		const mineRule =
			css.match(/\.reaction-pill\.mine \{(?<body>[^}]+)\}/)?.groups?.["body"] ??
			"";

		expect(mineRule).toContain(
			"box-shadow: inset 0 0 0 1px var(--accent-border)",
		);
		expect(mineRule).not.toContain("background: var(--grass-3)");
		expect(mineRule).not.toContain("color: var(--accent-text)");
	});
});
