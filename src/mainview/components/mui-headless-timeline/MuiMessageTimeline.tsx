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
import { TimelineScrollKeeper } from "./TimelineScrollKeeper";

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
        const value = useMemo<MuiTimelineContextValue>(() => ({
		currentUserId: data.currentUserId,
	        onOpenAttachment: props.onOpenAttachment,
	        onShowMessageContextMenu: props.onShowMessageContextMenu,
	        onSetUserColor: props.onSetUserColor,
	        onStartDm: props.onStartDm,
	        onReply: props.onReply,
	        onToggleReaction: props.onToggleReaction,
	        onVotePoll: props.onVotePoll,
	}), [
	        data.currentUserId,
	        props.onOpenAttachment,
	        props.onReply,
	        props.onSetUserColor,
	        props.onShowMessageContextMenu,
	        props.onStartDm,
	        props.onToggleReaction,
	        props.onVotePoll,
	]);
	return (
		<MuiTimelineProvider value={value}>
			<MuiMessageTimelineInner {...props} />
		</MuiTimelineProvider>
	);
}

const MuiMessageTimelineInner = memo(function MuiMessageTimelineInner(props: MuiMessageTimelineProps) {
	const data = useSnapshot(chatDataStore);
	const messages = useMemo(
		() => buildMuiTimelineMessages(props.posts, {
		        channelId: props.channelId,
		        currentUserId: data.currentUserId,
		        users: data.users,
		        userColors: data.userColors,
		        userImages: data.userImages,
		        userStatuses: data.userStatuses,
		}),
		[
			props.posts,
			props.channelId,
			data.currentUserId,
			data.users,
			data.userColors,
			data.userImages,
			data.userStatuses,
		],
	);
	const members = useMemo(
		() =>
			buildMuiUsers(
				data.users,
				data.userStatuses,
				data.userImages,
				data.currentUserId,
			),
		[
			data.users,
			data.userStatuses,
			data.userImages,
			data.currentUserId,
		],
	);
	const currentUser = useMemo(
		() =>
                        members.find((member) => member.id === data.currentUserId) ?? {
				id: data.currentUserId,
				displayName: data.currentUser?.username ?? data.currentUserId,
				avatarUrl: data.userImages[data.currentUserId],
				role: "user" as const,
				metadata: { mattermostUser: data.currentUser },
			},
		[members, data.currentUser, data.currentUserId, data.userImages],
	);
	const conversations = useMemo(
		() => [buildMuiConversation(props.channelId, members, props.channel)],
		[props.channelId, members, props.channel],
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
	const hasMoreHistory =
		data.hasMoreHistoryByChannel[props.channelId ?? ""] ?? true;
	const canLoadMore =
		props.onLoadMore &&
		!props.loadingHistory &&
		hasMoreHistory &&
		loadMoreReadyChannelId === props.channelId;
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
		const channelChanged = previousChannelId !== props.channelId;
		const channelContentLoaded =
			!channelChanged &&
			previousChannelId === props.channelId &&
			!previousLastMessageId &&
			Boolean(lastMessageId);
		previousChannelIdRef.current = props.channelId;
		previousLastMessageIdRef.current = lastMessageId;
		if (channelChanged) setLoadMoreReadyChannelId(undefined);
		if (!lastMessageId || (!channelChanged && !channelContentLoaded)) return;

		// The initial pin only; late height changes (images, avatars) are
		// corrected by TimelineScrollKeeper's settle window, so no rAF
		// re-scroll is needed here.
		messageListRef.current?.scrollToBottom({ behavior: "auto" });
	        setLoadMoreReadyChannelId(props.channelId);
	}, [props.channelId, lastMessageId]);

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
					// When the "Indicate my messages" toggle is off, drive the
					// indicator variable transparent so the own-message accent
					// bar disappears live (the main bubble applies `.own` from
					// message role, which doesn't otherwise react to the setting).
					"--own-message-indicator-color": data.settings
						.showOwnMessageIndicators
						? data.settings.ownMessageIndicatorColor
						: "transparent",
				} as React.CSSProperties
			}
		>
			<Chat.Root
				activeConversationId={props.channelId ?? "timeline"}
				adapter={timelineAdapter}
				className="mui-message-timeline-chat"
				conversations={conversations}
				currentUser={currentUser}
				members={members}
				messages={messages}
				partRenderers={mattermostPartRenderers}
				slotProps={muiChatRootSlotProps}
				variant={data.settings.showProfilePictures ? "default" : "compact"}
			>
				<MuiHistoryStateBridge
				        channelId={props.channelId}
				        loadingHistory={props.loadingHistory}
				        onLoadMore={props.onLoadMore}
				/>
				<Conversation.Root
					className="mui-message-timeline-conversation"
					slotProps={muiConversationSlotProps}
				>
					{props.loading ? (
						<div className="mui-timeline-state">Loading messages…</div>
					) : null}
					{!props.loading && messageIds.length === 0 ? (
						<div className="mui-timeline-empty">No messages yet.</div>
					) : null}
					<MessageList.Root
						ref={messageListRef}
						autoScroll={muiMessageListAutoScroll}
						estimatedItemSize={112}
						items={messageIds}
						overlay={
							<TimelineScrollKeeper
								buffer={muiMessageListAutoScroll.buffer}
								channelId={props.channelId}
							/>
						}
						slotProps={muiTimelineSlotProps.messageList}
						onReachTop={canLoadMore ? props.onLoadMore : undefined}
						renderItem={renderMessageItem}
					/>
					{props.typingUsers.length > 0 ? (
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
							<span>{typingLabel(props.typingUsers)}</span>
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

function MuiHistoryStateBridge({
	channelId,
	loadingHistory,
	onLoadMore,
}: Pick<MuiMessageTimelineProps, "channelId" | "loadingHistory" | "onLoadMore">) {
	const chatData = useSnapshot(chatDataStore);
	const store = useChatStore();
	useEffect(() => {
		const hasMoreHistory =
			chatData.hasMoreHistoryByChannel[channelId ?? ""] ?? true;
		store.setHistoryState({
			cursor: undefined,
			hasMore: hasMoreHistory && Boolean(onLoadMore),
		});
		store.setHistoryLoading(Boolean(loadingHistory));
	}, [
		store,
		chatData.hasMoreHistoryByChannel,
		onLoadMore,
		loadingHistory,
		channelId,
	]);
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
	const data = useSnapshot(chatDataStore);
	const metadata = message.metadata as MattermostMessageMetadata;
	const post = metadata.post;
	const author = data.users[post.user_id];
	const image = data.userImages[post.user_id];
	const status = data.userStatuses[post.user_id];
	const userColor = data.userColors[post.user_id];
	const showProfilePictures = data.settings.showProfilePictures;
	const deleted = metadata.deleted;
	const grouped = isGroupedMessage(message, previousMessage, groupKey);
	const metaClassName = showProfilePictures
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
						{!grouped && showProfilePictures ? (
							<div className="mui-message-meta-avatar">
                                                                {image ? (
									<img alt="" src={image} />
								) : (
									initials(author?.nickname || author?.username || post.user_id)
								)}
							</div>
						) : null}
						{!grouped ? (
							<UserDetailsTrigger
								currentUserId={context.currentUserId}
								fallback={post.user_id}
								imageSrc={image}
								status={status?.status}
								triggerClassName="mui-message-author message-author"
								user={author}
								userColor={userColor}
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
