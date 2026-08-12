import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToString } from "react-dom/server";
import { POLL_POST_TYPE } from "../../mattermostApi";
import { chatDataActions } from "../../state/chatDataStore";
import type {
	AppSettings,
	MattermostChannel,
	MattermostPost,
	MattermostUser,
} from "../../types";
import { formatTime } from "../../utils/format";
import {
	getStableMessageIds,
	MuiMessageTimeline,
	type MuiMessageTimelineProps,
} from "./MuiMessageTimeline";
import type { MuiTimelineContextValue } from "./MuiTimelineContext";
import {
	buildMuiConversation,
	buildMuiTimelineMessages,
	buildMuiUsers,
} from "./muiChatModels";

const channel: MattermostChannel = {
	id: "channel-1",
	team_id: "team-1",
	name: "town-square",
	display_name: "Town Square",
	type: "O",
};
const currentUser: MattermostUser = { id: "user-1", username: "sarah" };
const otherUser: MattermostUser = { id: "user-2", username: "alex" };
const baseTime = new Date("2026-01-01T12:00:00Z").getTime();

function post(overrides: Partial<MattermostPost>): MattermostPost {
	return {
		id: "post-1",
		create_at: baseTime,
		update_at: baseTime,
		delete_at: 0,
		user_id: otherUser.id,
		channel_id: "channel-1",
		message: "hello **world**",
		...overrides,
	};
}

const users: Record<string, MattermostUser> = {
	[currentUser.id]: currentUser,
	[otherUser.id]: otherUser,
};
const testSettings: AppSettings = {
	fontFamily: "system",
	fontSize: 14,
	theme: "default",
	showOwnMessageIndicators: true,
	ownMessageIndicatorColor: "#00aa00",
	notificationSounds: true,
	notificationPreference: "all",
	showProfilePictures: true,
	useNewComposer: false,
	devLoopback: false,
};

function seedChatData() {
	chatDataActions.setCurrentUser(currentUser);
	chatDataActions.setUsers(users);
	chatDataActions.setSettings(testSettings);
	chatDataActions.setUserColors({});
	chatDataActions.setUserImages({});
	chatDataActions.setUserStatuses({});
	chatDataActions.setResolveImageSrc(async (src) => src);
}

beforeEach(() => {
	chatDataActions.resetForSignOut();
	seedChatData();
});

function timelineProps(
	overrides: Partial<MuiMessageTimelineProps> = {},
): MuiMessageTimelineProps {
	return {
		posts: [post({})],
		channel,
		channelId: "channel-1",
		loading: false,
		loadingHistory: false,
		typingUsers: [],
		onOpenAttachment: async () => {},
		onShowMessageContextMenu: () => {},
		onSetUserColor: () => {},
		onStartDm: () => {},
		onReply: () => {},
		onToggleReaction: async () => {},
		onVotePoll: async () => {},
		onLoadMore: undefined,
		...overrides,
	};
}

function contextValue(
	overrides: Partial<MuiTimelineContextValue> = {},
): MuiTimelineContextValue {
	return {
		...timelineProps(),
		currentUser,
		currentUserId: currentUser.id,
		users,
		userColors: {},
		userImages: {},
		userStatuses: {},
		settings: testSettings,
		resolveImageSrc: async (src) => src,
		...overrides,
	};
}

describe("MuiMessageTimeline", () => {
	test("uses the MUI conversation wrapper", () => {
		const source = readFileSync(
			"src/mainview/components/mui-headless-timeline/MuiMessageTimeline.tsx",
			"utf8",
		);

		expect(source).toContain("Conversation,");
		expect(source).toContain("<Conversation.Root");
	});

	test("maps channel and current user objects into MUI models", () => {
		const value = contextValue();
		const members = buildMuiUsers(
			value.users,
			value.userStatuses,
			value.userImages,
			value.currentUser.id,
		);
		const conversation = buildMuiConversation(
			value.channelId,
			members,
			value.channel,
		);

		expect(conversation.title).toBe("Town Square");
		expect(conversation.metadata).toEqual({ mattermostChannel: channel });
		expect(members.find((member) => member.id === currentUser.id)?.role).toBe(
			"user",
		);
	});

	test("stores Mattermost rendering metadata on MUI messages", () => {
		const poll = {
			question: "Lunch?",
			options: [{ id: "pizza", text: "Pizza" }],
			votes: {},
		};
		const file = {
			id: "file-1",
			name: "notes.pdf",
			mime_type: "application/pdf",
		};
		const reaction = {
			post_id: "post-1",
			user_id: currentUser.id,
			emoji_name: "thumbsup",
		};
		const [message] = buildMuiTimelineMessages(
			[
				post({
					type: POLL_POST_TYPE,
					props: { poll },
					metadata: { files: [file], reactions: [reaction] },
					pending: true,
					failed: true,
				}),
			],
			contextValue(),
		);

		expect(message.metadata).toMatchObject({
			files: [file],
			reactions: [reaction],
			poll,
			pending: true,
			failed: true,
		});
	});

	test("wires top-level message profile actions", () => {
		const source = readFileSync(
			"src/mainview/components/mui-headless-timeline/MuiMessageTimeline.tsx",
			"utf8",
		);

		expect(source).toContain("<UserDetailsTrigger");
		expect(source).toContain("onSetUserColor={context.onSetUserColor}");
		expect(source).toContain("onStartDm={context.onStartDm}");
	});

	test("keeps MUI list item ids stable when message objects rebuild with the same ids", () => {
		const firstMessages = buildMuiTimelineMessages(
			[post({ id: "post-1" }), post({ id: "post-2", create_at: baseTime + 1 })],
			contextValue(),
		);
		const firstIds = getStableMessageIds(firstMessages, null);
		const rebuiltMessages = buildMuiTimelineMessages(
			[post({ id: "post-1" }), post({ id: "post-2", create_at: baseTime + 1 })],
			contextValue(),
		);
		const rebuiltIds = getStableMessageIds(rebuiltMessages, firstIds);

		expect(rebuiltIds).toBe(firstIds);
	});

	test("scrolls to the bottom when channel messages first load before enabling load more", () => {
		const source = readFileSync(
			"src/mainview/components/mui-headless-timeline/MuiMessageTimeline.tsx",
			"utf8",
		);

		expect(source).toContain("MessageListRootHandle");
		expect(source).toContain("messageListRef");
		expect(source).toContain('scrollToBottom({ behavior: "auto" })');
		expect(source).toContain("channelContentLoaded");
		expect(source).toContain("context.posts,");
		expect(source).not.toContain("[context],");
		expect(source).toContain("loadMoreReadyChannelId === context.channelId");
		expect(source).toContain("setLoadMoreReadyChannelId(context.channelId)");
		expect(source).toContain(
			"onReachTop={canLoadMore ? context.onLoadMore : undefined}",
		);
	});

	test("renders top-level message meta before message content", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline {...timelineProps()} />
			</Tooltip.Provider>,
		);
		const metaIndex = html.indexOf("mui-message-meta has-avatar");
		const statusIndex = html.indexOf("status-dot", metaIndex);
		const authorIndex = html.indexOf("@alex", statusIndex);
		const timeIndex = html.indexOf(formatTime(baseTime), authorIndex);
		const contentIndex = html.indexOf("hello", timeIndex);

		expect(metaIndex).toBeGreaterThan(-1);
		expect(statusIndex).toBeGreaterThan(metaIndex);
		expect(authorIndex).toBeGreaterThan(statusIndex);
		expect(timeIndex).toBeGreaterThan(authorIndex);
		expect(contentIndex).toBeGreaterThan(timeIndex);
	});

	test("does not render repeated meta for grouped messages", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline
					{...timelineProps({
						posts: [
							post({ id: "post-1", message: "first" }),
							post({
								id: "post-2",
								message: "second",
								create_at: baseTime + 60_000,
								update_at: baseTime + 60_000,
							}),
						],
					})}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain('class="mui-message-meta has-avatar"');
		expect(html).toContain('class="mui-message-meta has-avatar is-grouped"');
		expect(
			html.match(/class="mui-message-author message-author"/g)?.length,
		).toBe(1);
		expect(html.match(new RegExp(formatTime(baseTime), "g"))?.length).toBe(1);
		expect(html).toContain("first");
		expect(html).toContain("second");
	});

	test("maps a Mattermost post to a MUI message with markdown text", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline {...timelineProps()} />
			</Tooltip.Provider>,
		);

		expect(html).toContain("hello");
		expect(html).toContain("world");
		expect(html).toContain("markdown-message");
	});

	test("styles mentions and current-user mentions in markdown text", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline
					{...timelineProps({
						posts: [post({ message: "hi @alex and @sarah and @here" })],
					})}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain('class="mention"');
		expect(html).toContain('class="mention-highlight"');
		expect(html).toContain("mention-here");
		expect(html).toContain("@alex");
		expect(html).toContain("@sarah");
		expect(html).toContain("@here");
	});

	test("renders typing users as the legacy floating typing indicator", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline {...timelineProps({ typingUsers: [otherUser] })} />
			</Tooltip.Provider>,
		);

		expect(html).toContain("typing-indicator mui-timeline-typing");
		expect(html).toContain("typing-dots");
		expect(html).toContain("alex is typing…");
	});

	test("preserves reply context menu handling", () => {
		const source = readFileSync(
			"src/mainview/components/mui-headless-timeline/MuiTimelineReplies.tsx",
			"utf8",
		);

		expect(source).toContain("onContextMenu");
		expect(source).toContain("context.onShowMessageContextMenu(reply)");
	});

	test("keeps replies nested in their parent message parts", () => {
		const parent = post({ id: "parent", message: "parent body" });
		const reply = post({
			id: "reply",
			root_id: "parent",
			message: "nested reply body",
			create_at: baseTime + 1,
			update_at: baseTime + 1,
		});
		const messages = buildMuiTimelineMessages([reply, parent], contextValue());

		expect(messages).toHaveLength(1);
		expect(messages[0].parts.some((part) => part.type === "data-replies")).toBe(
			true,
		);

		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline {...timelineProps({ posts: [reply, parent] })} />
			</Tooltip.Provider>,
		);
		expect(html).toContain("parent body");
		expect(html).toContain("nested reply body");
		expect(html).toContain("reply-message-meta");
		expect(html).toContain(formatTime(baseTime + 1));
	});

	test("deleted posts do not render stale message text", () => {
		const deleted = post({
			delete_at: baseTime + 2,
			message: "stale deleted text",
		});
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline {...timelineProps({ posts: [deleted] })} />
			</Tooltip.Provider>,
		);

		expect(html).toContain("(deleted)");
		expect(html).not.toContain("stale deleted text");
	});

	test("attachments use the MessageAttachments rendering path", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline
					{...timelineProps({
						posts: [
							post({
								metadata: {
									files: [
										{
											id: "file-1",
											name: "notes.pdf",
											mime_type: "application/pdf",
										},
									],
								},
							}),
						],
					})}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain("message-attachments");
		expect(html).toContain("notes.pdf");
	});

	test("reactions are grouped with ReactionPill output", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline
					{...timelineProps({
						posts: [
							post({
								metadata: {
									reactions: [
										{
											post_id: "post-1",
											user_id: currentUser.id,
											emoji_name: "thumbsup",
										},
									],
								},
							}),
						],
					})}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain("reaction-pill mine");
		expect(html).toContain("1");
	});

	test("uses MUI reach-top loading without rendering a separate load-more button", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline {...timelineProps({ onLoadMore: () => {} })} />
			</Tooltip.Provider>,
		);

		expect(html).not.toContain("Load older messages");
	});

	test("renders poll message parts", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline
					{...timelineProps({
						posts: [
							post({
								type: POLL_POST_TYPE,
								props: {
									poll: {
										question: "Lunch?",
										options: [{ id: "pizza", text: "Pizza" }],
										votes: {},
									},
								},
							}),
						],
					})}
				/>
			</Tooltip.Provider>,
		);

		expect(html).toContain("Lunch?");
		expect(html).toContain("Pizza");
	});
});
