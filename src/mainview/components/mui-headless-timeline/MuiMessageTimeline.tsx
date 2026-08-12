import type {
	ChatAdapter,
	ChatMessage,
	MessageListRootHandle,
} from "@mui/x-chat/headless";
import {
	Chat,
	Conversation,
	createTimeWindowGroupKey,
	Message,
	MessageGroup,
	MessageList,
	useChatStore,
} from "@mui/x-chat/headless";
import { Reply, SmilePlus } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { chatDataStore } from "../../state/chatDataStore";
import { normalizeEmojiName } from "../../utils/emoji";
import { formatDateDivider, formatTime, initials } from "../../utils/format";
import {
	__flushPerfRenderCounts,
	isPerfEnabled,
	markRender,
} from "../../utils/perfTrace";
import { EmojiPickerPopover } from "../EmojiPickerPopover";
import { UserDetailsTrigger } from "../UserDetailsTrigger";
import { mattermostPartRenderers } from "./MattermostPartRenderers";
import {
	type MuiMessageTimelineProps,
	type MuiTimelineContextValue,
	MuiTimelineProvider,
	useMuiTimelineContext,
} from "./MuiTimelineContext";
import { muiTimelineSlotProps } from "./MuiTimelineSlots";
import {
	buildMuiConversation,
	buildMuiTimelineMessages,
	buildMuiUsers,
	type MattermostMessageMetadata,
} from "./muiChatModels";

const timelineAdapter: ChatAdapter = {
	sendMessage: async () => new ReadableStream(),
};

const muiChatRootSlotProps = {
	root: { className: "mui-message-timeline-chat-root" },
};
const muiConversationSlotProps = {
	root: { className: "mui-message-timeline-conversation-root" },
};
const muiMessageListAutoScroll = { buffer: 96 };

export type { MuiMessageTimelineProps };

export function getStableMessageIds(
	messages: ChatMessage[],
	previous: string[] | null,
) {
	const next = messages.map((message) => message.id);
	if (
		previous &&
		previous.length === next.length &&
		previous.every((id, index) => id === next[index])
	) {
		return previous;
	}
	return next;
}

export function isGroupedMessage(
	message: ChatMessage,
	previousMessage: ChatMessage | undefined,
	groupKey: ReturnType<typeof createTimeWindowGroupKey>,
) {
	return Boolean(
		previousMessage && groupKey(previousMessage) === groupKey(message),
	);
}

export function MuiMessageTimeline(props: MuiMessageTimelineProps) {
	const data = useSnapshot(chatDataStore);
	const currentUser = data.currentUser ?? {
		id: data.currentUserId,
		username: data.currentUserId,
	};
	const value: MuiTimelineContextValue = {
		...props,
		currentUser,
		currentUserId: data.currentUserId,
		users: data.users,
		userColors: data.userColors,
		userImages: data.userImages,
		userStatuses: data.userStatuses,
		settings: data.settings,
		resolveImageSrc: data.resolveImageSrc,
	};
	return (
		<MuiTimelineProvider value={value}>
			<MuiMessageTimelineInner />
		</MuiTimelineProvider>
	);
}

const MuiMessageTimelineInner = memo(function MuiMessageTimelineInner() {
	const context = useMuiTimelineContext();
	const messages = useMemo(
		() => buildMuiTimelineMessages(context.posts, context),
		[
			context.posts,
			context.users,
			context.userColors,
			context.userImages,
			context.userStatuses,
			context.channelId,
			context.currentUserId,
		],
	);
	const members = useMemo(
		() =>
			buildMuiUsers(
				context.users,
				context.userStatuses,
				context.userImages,
				context.currentUserId,
			),
		[
			context.users,
			context.userStatuses,
			context.userImages,
			context.currentUserId,
		],
	);
	const currentUser = useMemo(
		() =>
			members.find((member) => member.id === context.currentUser.id) ?? {
				id: context.currentUser.id,
				displayName: context.currentUser.username,
				avatarUrl: context.userImages[context.currentUser.id],
				role: "user" as const,
				metadata: { mattermostUser: context.currentUser },
			},
		[members, context.currentUser, context.userImages],
	);
	const conversations = useMemo(
		() => [buildMuiConversation(context.channelId, members, context.channel)],
		[context.channelId, members, context.channel],
	);
	const messageIdsRef = useRef<string[] | null>(null);
	const messageIds = useMemo(() => {
		const next = getStableMessageIds(messages, messageIdsRef.current);
		messageIdsRef.current = next;
		return next;
	}, [messages]);
	const messageById = useMemo(
		() => new Map(messages.map((message) => [message.id, message])),
		[messages],
	);
	const groupKey = useMemo(() => createTimeWindowGroupKey(5 * 60_000), []);
	const messageListRef = useRef<MessageListRootHandle>(null);
	const previousChannelIdRef = useRef<string | null | undefined>(undefined);
	const previousLastMessageIdRef = useRef<string | undefined>(undefined);
	const [loadMoreReadyChannelId, setLoadMoreReadyChannelId] = useState<
		string | null | undefined
	>(undefined);
	const lastMessageId = messageIds.at(-1);
	const canLoadMore =
		context.onLoadMore &&
		!context.loadingHistory &&
		loadMoreReadyChannelId === context.channelId;
	const renderMessageItem = useCallback(
		({ id, index }: { id: string; index: number }) => {
			const message = messageById.get(id);
			if (!message) return null;
			return (
				<MuiMessageItem
					groupKey={groupKey}
					index={index}
					key={id}
					message={message}
					messageIds={messageIds}
					previousMessage={messageById.get(messageIds[index - 1])}
				/>
			);
		},
		[groupKey, messageById, messageIds],
	);

	useEffect(() => {
		const previousChannelId = previousChannelIdRef.current;
		const previousLastMessageId = previousLastMessageIdRef.current;
		const channelChanged = previousChannelId !== context.channelId;
		const channelContentLoaded =
			!channelChanged &&
			previousChannelId === context.channelId &&
			!previousLastMessageId &&
			Boolean(lastMessageId);
		previousChannelIdRef.current = context.channelId;
		previousLastMessageIdRef.current = lastMessageId;
		if (channelChanged) setLoadMoreReadyChannelId(undefined);
		if (!lastMessageId || (!channelChanged && !channelContentLoaded)) return;

		messageListRef.current?.scrollToBottom({ behavior: "auto" });
		const frameId = requestAnimationFrame(() => {
			messageListRef.current?.scrollToBottom({ behavior: "auto" });
			setLoadMoreReadyChannelId(context.channelId);
		});
		return () => cancelAnimationFrame(frameId);
	}, [context.channelId, lastMessageId]);

	useEffect(() => {
		if (!isPerfEnabled()) return;
		const flushId = setInterval(__flushPerfRenderCounts, 1500);
		return () => {
			clearInterval(flushId);
			__flushPerfRenderCounts();
		};
	}, []);

	return (
		<div
			className="mui-message-timeline"
			style={
				{
					"--own-message-indicator-color":
						context.settings.ownMessageIndicatorColor,
				} as React.CSSProperties
			}
		>
			<Chat.Root
				activeConversationId={context.channelId ?? "timeline"}
				adapter={timelineAdapter}
				className="mui-message-timeline-chat"
				conversations={conversations}
				currentUser={currentUser}
				members={members}
				messages={messages}
				partRenderers={mattermostPartRenderers}
				slotProps={muiChatRootSlotProps}
				variant={context.settings.showProfilePictures ? "default" : "compact"}
			>
				<MuiHistoryStateBridge />
				<Conversation.Root
					className="mui-message-timeline-conversation"
					slotProps={muiConversationSlotProps}
				>
					{context.loading ? (
						<div className="mui-timeline-state">Loading messages…</div>
					) : null}
					{!context.loading && messageIds.length === 0 ? (
						<div className="mui-timeline-empty">No messages yet.</div>
					) : null}
					<MessageList.Root
						ref={messageListRef}
						autoScroll={muiMessageListAutoScroll}
						estimatedItemSize={112}
						items={messageIds}
						slotProps={muiTimelineSlotProps.messageList}
						onReachTop={canLoadMore ? context.onLoadMore : undefined}
						renderItem={renderMessageItem}
					/>
					{context.typingUsers.length > 0 ? (
						<div
							className="typing-indicator mui-timeline-typing"
							role="status"
							aria-live="polite"
						>
							<span className="typing-dots" aria-hidden="true">
								<span />
								<span />
								<span />
							</span>
							<span>{typingLabel(context.typingUsers)}</span>
						</div>
					) : null}
				</Conversation.Root>
			</Chat.Root>
		</div>
	);
});

function typingLabel(users: { username: string }[]) {
	const names = users.map((user) => user.username).filter(Boolean);
	if (names.length === 1) return `${names[0]} is typing…`;
	if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
	return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others are typing…`;
}

function MuiHistoryStateBridge() {
	const context = useMuiTimelineContext();
	const store = useChatStore();
	useEffect(() => {
		store.setHistoryState({
			cursor: undefined,
			hasMore: Boolean(context.onLoadMore),
		});
		store.setHistoryLoading(Boolean(context.loadingHistory));
	}, [store, context.onLoadMore, context.loadingHistory]);
	return null;
}

const MuiMessageItem = memo(function MuiMessageItem({
	groupKey,
	index,
	message,
	messageIds,
	previousMessage,
}: {
	groupKey: ReturnType<typeof createTimeWindowGroupKey>;
	index: number;
	message: ChatMessage;
	messageIds: string[];
	previousMessage: ChatMessage | undefined;
}) {
	markRender("MuiMessageItem");
	const context = useMuiTimelineContext();
	const metadata = message.metadata as MattermostMessageMetadata;
	const post = metadata.post;
	const author = context.users[post.user_id];
	const deleted = metadata.deleted;
	const grouped = isGroupedMessage(message, previousMessage, groupKey);
	const metaClassName = context.settings.showProfilePictures
		? "mui-message-meta has-avatar"
		: "mui-message-meta";
	const canReply = !deleted && (!post.root_id || post.root_id === post.id);

	return (
		<>
			<MessageList.DateDivider
				formatDate={(date) => formatDateDivider(date.getTime())}
				index={index}
				messageId={message.id}
				slotProps={muiTimelineSlotProps.dateDivider}
			/>
			<MessageGroup
				groupKey={groupKey}
				index={index}
				items={messageIds}
				messageId={message.id}
				slotProps={muiTimelineSlotProps.messageGroup}
			>
				<Message.Root
					messageId={message.id}
					onContextMenu={(event) => {
						event.preventDefault();
						context.onShowMessageContextMenu(post);
					}}
					slotProps={muiTimelineSlotProps.messageRoot}
				>
					<div
						aria-hidden={grouped ? true : undefined}
						className={grouped ? `${metaClassName} is-grouped` : metaClassName}
					>
						{!grouped && context.settings.showProfilePictures ? (
							<div className="mui-message-meta-avatar">
								{context.userImages[post.user_id] ? (
									<img alt="" src={context.userImages[post.user_id]} />
								) : (
									initials(author?.nickname || author?.username || post.user_id)
								)}
							</div>
						) : null}
						{!grouped ? (
							<UserDetailsTrigger
								currentUserId={context.currentUserId}
								fallback={post.user_id}
								imageSrc={context.userImages[post.user_id]}
								status={context.userStatuses[post.user_id]?.status}
								triggerClassName="mui-message-author message-author"
								user={author}
								userColor={metadata.userColor}
								onSetUserColor={context.onSetUserColor}
								onStartDm={context.onStartDm}
							/>
						) : null}
						{!grouped ? <time>{formatTime(post.create_at)}</time> : null}
						{!grouped && post.pending ? (
							<span className="message-state">sending</span>
						) : null}
						{!grouped && post.failed ? (
							<span className="message-state failed">failed</span>
						) : null}
					</div>
					<div className="mui-message-content-wrap">
						<Message.Content slotProps={muiTimelineSlotProps.messageContent} />
					</div>
					<Message.Actions slotProps={muiTimelineSlotProps.messageActions}>
						{canReply ? (
							<button
								aria-label="Reply"
								className="mui-timeline-action"
								type="button"
								onClick={() => context.onReply(post)}
							>
								<Reply size={14} />
							</button>
						) : null}
						{!deleted ? (
							<EmojiPickerPopover
								label="Add reaction"
								onSelectEmoji={(_, emojiName) =>
									void context.onToggleReaction(
										post,
										normalizeEmojiName(emojiName),
									)
								}
							>
								<button
									aria-label="Add reaction"
									className="mui-timeline-action"
									type="button"
								>
									<SmilePlus size={14} />
								</button>
							</EmojiPickerPopover>
						) : null}
					</Message.Actions>
				</Message.Root>
			</MessageGroup>
		</>
	);
});
