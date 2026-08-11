import { Reply, SmilePlus } from "lucide-react";
import { memo, useMemo } from "react";
import { normalizeEmojiName } from "../../utils/emoji";
import { formatTime } from "../../utils/format";
import { EmojiPickerPopover } from "../EmojiPickerPopover";
import { MessageAttachments } from "../MessageAttachments";
import { MarkdownRenderer } from "../MessageMarkdown";
import { groupReactions, ReactionPill } from "../MessageReactions";
import { UserDetailsTrigger } from "../UserDetailsTrigger";
import { useMuiTimelineContext } from "./MuiTimelineContext";
import type { MattermostMessagePart } from "./muiChatModels";

export const MuiTimelineReplies = memo(function MuiTimelineReplies({
	part,
}: {
	part: Extract<MattermostMessagePart, { type: "data-replies" }>;
}) {
	return (
		<div className="mui-timeline-replies">
			{part.data.replies.map((reply) => (
				<MuiTimelineReply key={reply.id} reply={reply} />
			))}
		</div>
	);
});

const MuiTimelineReply = memo(function MuiTimelineReply({
	reply,
}: {
	reply: Extract<
		MattermostMessagePart,
		{ type: "data-replies" }
	>["data"]["replies"][number];
}) {
	const context = useMuiTimelineContext();
	const author = context.users[reply.user_id];
	const groupedReactions = useMemo(
		() =>
			groupReactions(reply.metadata?.reactions ?? [], context.currentUserId),
		[reply.metadata?.reactions, context.currentUserId],
	);
	const deleted = reply.delete_at > 0;
	const isOwnMessage =
		context.showOwnMessageIndicators && reply.user_id === context.currentUserId;
	return (
		<div
			className={isOwnMessage ? "reply-message own" : "reply-message"}
			onContextMenu={(event) => {
				event.preventDefault();
				context.onShowMessageContextMenu(reply);
			}}
		>
			<div className="mui-message-meta reply-message-meta">
				<UserDetailsTrigger
					currentUserId={context.currentUserId}
					fallback={reply.user_id}
					imageSrc={context.userImages[reply.user_id]}
					status={context.userStatuses[reply.user_id]?.status}
					triggerClassName="mui-message-author reply-message-author message-author"
					user={author}
					userColor={context.userColors[reply.user_id]}
					onSetUserColor={context.onSetUserColor}
					onStartDm={context.onStartDm}
				/>
				<time>{formatTime(reply.create_at)}</time>
			</div>
			<div className="mui-message-content-wrap reply-message-content-wrap">
				{deleted ? (
					<div className="markdown-message">(deleted)</div>
				) : (
					<>
						<MarkdownRenderer
							currentUsername={context.users[context.currentUserId]?.username}
							markdown={reply.message}
							resolveImageSrc={context.resolveImageSrc}
							useNewComposer={context.useNewComposer}
						/>
						<MessageAttachments
							files={reply.metadata?.files ?? []}
							resolveImageSrc={context.resolveImageSrc}
							onOpenAttachment={context.onOpenAttachment}
						/>
						{groupedReactions.length > 0 ? (
							<div className="reaction-list">
								{groupedReactions.map((reaction) => (
									<ReactionPill
										key={reaction.emojiName}
										reaction={reaction}
										users={context.users}
										onClick={() =>
											void context.onToggleReaction(reply, reaction.emojiName)
										}
									/>
								))}
							</div>
						) : null}
					</>
				)}
			</div>
			{!deleted ? (
				<div className="reply-message-actions">
					<button
						aria-label="Reply"
						className="mui-timeline-action reply-message-reply-add"
						type="button"
						onClick={() => context.onReply(reply)}
					>
						<Reply size={13} />
					</button>
					<EmojiPickerPopover
						label="Add reaction"
						onSelectEmoji={(_, emojiName) =>
							void context.onToggleReaction(
								reply,
								normalizeEmojiName(emojiName),
							)
						}
					>
						<button
							aria-label="Add reaction"
							className="mui-timeline-action reply-reaction-add"
							type="button"
						>
							<SmilePlus size={14} />
						</button>
					</EmojiPickerPopover>
				</div>
			) : null}
		</div>
	);
});
