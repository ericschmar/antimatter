import { Reply, SmilePlus } from "lucide-react";
import { memo, useMemo } from "react";
import { POLL_POST_TYPE } from "../mattermostApi";
import type {
	MattermostFileInfo,
	MattermostPost,
	MattermostUser,
	MattermostUserStatus,
	PollProps,
} from "../types";
import { normalizeEmojiName } from "../utils/emoji";
import { formatTime, initials } from "../utils/format";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import { MessageAttachments } from "./MessageAttachments";
import { MarkdownRenderer } from "./MessageMarkdown";
import { groupReactions, ReactionPill } from "./MessageReactions";
import { UserDetailsTrigger } from "./UserDetailsTrigger";

export const MessageRow = memo(
	function MessageRow({
		currentUserId,
		post,
		replies,
		userColor,
		userColors,
		userImages,
		userStatuses,
		users,
		resolveImageSrc,
		showOwnMessageIndicators,
		showProfilePictures,
		useNewComposer,
		onOpenAttachment,
		onShowMessageContextMenu,
		onSetUserColor,
		onStartDm,
		onReply,
		onToggleReaction,
		onVotePoll,
	}: {
		currentUserId: string;
		post: MattermostPost;
		replies: MattermostPost[];
		userColor?: string;
		userColors: Record<string, string>;
		userImages: Record<string, string>;
		userStatuses: Record<string, MattermostUserStatus>;
		users: Record<string, MattermostUser>;
		resolveImageSrc: (src: string) => Promise<string>;
		showOwnMessageIndicators: boolean;
		showProfilePictures: boolean;
		useNewComposer: boolean;
		onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
		onShowMessageContextMenu: (post: MattermostPost) => void;
		onSetUserColor: (userId: string, color: string) => void;
		onStartDm: (userId: string) => void;
		onReply: (post: MattermostPost) => void;
		onToggleReaction: (
			post: MattermostPost,
			emojiName: string,
		) => Promise<void>;
		onVotePoll: (post: MattermostPost, optionId: string) => Promise<void>;
	}) {
		const author = users[post.user_id];
		const groupedReactions = useMemo(
			() => groupReactions(post.metadata?.reactions ?? [], currentUserId),
			[post.metadata?.reactions, currentUserId],
		);
		const deleted = post.delete_at > 0;
		const poll = post.type === POLL_POST_TYPE ? post.props?.poll : undefined;
		const canReply = !deleted && (!post.root_id || post.root_id === post.id);
		const authorStatus = userStatuses[post.user_id]?.status;
		const isOwnMessage =
			showOwnMessageIndicators && post.user_id === currentUserId;
		return (
			<article
				className={isOwnMessage ? "message own" : "message"}
				onContextMenu={(event) => {
					event.preventDefault();
					onShowMessageContextMenu(post);
				}}
			>
				<div
					className={
						showProfilePictures ? "message-meta has-avatar" : "message-meta"
					}
				>
					{showProfilePictures ? (
						<div className="message-meta-avatar">
							{userImages[post.user_id] ? (
								<img alt="" src={userImages[post.user_id]} />
							) : (
								initials(author?.nickname || author?.username || post.user_id)
							)}
						</div>
					) : null}
					<UserDetailsTrigger
						currentUserId={currentUserId}
						fallback={post.user_id}
						imageSrc={userImages[post.user_id]}
						status={authorStatus}
						userColor={userColor}
						user={author}
						onSetUserColor={onSetUserColor}
						onStartDm={onStartDm}
					/>
					<time>{formatTime(post.create_at)}</time>
					{post.pending ? <span className="message-state">sending</span> : null}
					{post.failed ? (
						<span className="message-state failed">failed</span>
					) : null}
				</div>
				<div className="message-content">
					{deleted ? (
						<div className="markdown-message">(deleted)</div>
					) : poll ? (
						<PollMessage
							currentUserId={currentUserId}
							poll={poll}
							onVote={(optionId) => void onVotePoll(post, optionId)}
						/>
					) : (
						<MarkdownRenderer
							currentUsername={users[currentUserId]?.username}
							markdown={post.message}
							resolveImageSrc={resolveImageSrc}
							useNewComposer={useNewComposer}
						/>
					)}
					{!deleted ? (
						<>
							<MessageAttachments
								files={post.metadata?.files ?? []}
								resolveImageSrc={resolveImageSrc}
								onOpenAttachment={onOpenAttachment}
							/>
							{groupedReactions.length > 0 ? (
								<div className="reaction-list">
									{groupedReactions.map((reaction) => (
										<ReactionPill
											key={reaction.emojiName}
											reaction={reaction}
											users={users}
											onClick={() =>
												void onToggleReaction(post, reaction.emojiName)
											}
										/>
									))}
								</div>
							) : null}
						</>
					) : null}
					{replies.length > 0 ? (
						<div className="message-replies">
							{replies.map((reply) => (
								<ReplyMessage
									currentUserId={currentUserId}
									key={reply.id}
									post={reply}
									resolveImageSrc={resolveImageSrc}
									showOwnMessageIndicators={showOwnMessageIndicators}
									useNewComposer={useNewComposer}
									userColor={userColors[reply.user_id]}
									userImages={userImages}
									userStatuses={userStatuses}
									users={users}
									onOpenAttachment={onOpenAttachment}
									onReply={onReply}
									onSetUserColor={onSetUserColor}
									onStartDm={onStartDm}
									onToggleReaction={onToggleReaction}
								/>
							))}
						</div>
					) : null}
				</div>
				{canReply ? (
					<button
						aria-label="Reply"
						className="message-reply-add"
						type="button"
						onClick={() => onReply(post)}
					>
						<Reply size={14} />
					</button>
				) : null}
				{!deleted ? (
					<EmojiPickerPopover
						label="Add reaction"
						onSelectEmoji={(_, emojiName) =>
							void onToggleReaction(post, normalizeEmojiName(emojiName))
						}
					>
						<button
							aria-label="Add reaction"
							className="message-reaction-add"
							type="button"
						>
							<SmilePlus size={14} />
						</button>
					</EmojiPickerPopover>
				) : null}
			</article>
		);
	},
	(prevProps, nextProps) => {
		// Only re-render if rendered output or handlers can change
		const postUnchanged =
			prevProps.post.id === nextProps.post.id &&
			prevProps.post.update_at === nextProps.post.update_at &&
			prevProps.post.delete_at === nextProps.post.delete_at &&
			prevProps.post.message === nextProps.post.message &&
			prevProps.post.type === nextProps.post.type &&
			prevProps.post.props?.poll === nextProps.post.props?.poll &&
			prevProps.post.pending === nextProps.post.pending &&
			prevProps.post.failed === nextProps.post.failed &&
			prevProps.post.metadata?.files?.length ===
				nextProps.post.metadata?.files?.length &&
			prevProps.post.metadata?.reactions?.length ===
				nextProps.post.metadata?.reactions?.length;

		const repliesUnchanged =
			prevProps.replies.length === nextProps.replies.length &&
			prevProps.replies.every((reply, i) => {
				const nextReply = nextProps.replies[i];
				return (
					reply.id === nextReply?.id &&
					reply.update_at === nextReply.update_at &&
					reply.delete_at === nextReply.delete_at &&
					reply.message === nextReply.message &&
					reply.metadata?.files?.length === nextReply.metadata?.files?.length &&
					reply.metadata?.reactions?.length ===
						nextReply.metadata?.reactions?.length
				);
			});

		const handlerPropsUnchanged =
			prevProps.onStartDm === nextProps.onStartDm &&
			prevProps.onSetUserColor === nextProps.onSetUserColor &&
			prevProps.onReply === nextProps.onReply &&
			prevProps.onToggleReaction === nextProps.onToggleReaction &&
			prevProps.onVotePoll === nextProps.onVotePoll;

		const visualPropsUnchanged =
			prevProps.userColor === nextProps.userColor &&
			prevProps.showOwnMessageIndicators ===
				nextProps.showOwnMessageIndicators &&
			prevProps.showProfilePictures === nextProps.showProfilePictures &&
			prevProps.useNewComposer === nextProps.useNewComposer &&
			prevProps.userStatuses[prevProps.post.user_id]?.status ===
				nextProps.userStatuses[nextProps.post.user_id]?.status;

		return (
			postUnchanged &&
			repliesUnchanged &&
			handlerPropsUnchanged &&
			visualPropsUnchanged
		);
	},
);

const PollMessage = memo(function PollMessage({
	currentUserId,
	poll,
	onVote,
}: {
	currentUserId: string;
	poll: PollProps;
	onVote: (optionId: string) => void;
}) {
	const selectedOptionId = poll.votes[currentUserId];
	const totalVotes = Object.keys(poll.votes).length;

	return (
		<div className="poll-message">
			<div className="poll-question">{poll.question}</div>
			<div className="poll-options">
				{poll.options.map((option) => {
					const voteCount = Object.values(poll.votes).filter(
						(optionId) => optionId === option.id,
					).length;
					const selected = selectedOptionId === option.id;
					return (
						<button
							className={selected ? "poll-option selected" : "poll-option"}
							key={option.id}
							type="button"
							onClick={() => onVote(option.id)}
						>
							<span>{option.text}</span>
							<span
								className="poll-option-votes"
								title={`${voteCount} ${voteCount === 1 ? "vote" : "votes"}`}
							>
								{voteCount} {voteCount === 1 ? "vote" : "votes"}
							</span>
						</button>
					);
				})}
			</div>
			<div className="poll-total-votes">
				{totalVotes} {totalVotes === 1 ? "vote" : "votes"} total
			</div>
		</div>
	);
});

const ReplyMessage = memo(function ReplyMessage({
	currentUserId,
	post,
	resolveImageSrc,
	showOwnMessageIndicators,
	useNewComposer,
	userColor,
	userImages,
	userStatuses,
	users,
	onOpenAttachment,
	onReply,
	onSetUserColor,
	onStartDm,
	onToggleReaction,
}: {
	currentUserId: string;
	post: MattermostPost;
	resolveImageSrc: (src: string) => Promise<string>;
	showOwnMessageIndicators: boolean;
	useNewComposer: boolean;
	userColor?: string;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	users: Record<string, MattermostUser>;
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onReply: (post: MattermostPost) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onStartDm: (userId: string) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
}) {
	const author = users[post.user_id];
	const groupedReactions = useMemo(
		() => groupReactions(post.metadata?.reactions ?? [], currentUserId),
		[post.metadata?.reactions, currentUserId],
	);
	const deleted = post.delete_at > 0;
	const status = userStatuses[post.user_id]?.status;
	const isOwnMessage =
		showOwnMessageIndicators && post.user_id === currentUserId;
	return (
		<div className={isOwnMessage ? "reply-message own" : "reply-message"}>
			<div className="reply-message-meta">
				<UserDetailsTrigger
					currentUserId={currentUserId}
					fallback={post.user_id}
					imageSrc={userImages[post.user_id]}
					status={status}
					triggerClassName="reply-message-author message-author"
					userColor={userColor}
					user={author}
					onSetUserColor={onSetUserColor}
					onStartDm={onStartDm}
				/>
				<time>{formatTime(post.create_at)}</time>
			</div>
			{deleted ? (
				<div className="markdown-message">(deleted)</div>
			) : (
				<>
					<MarkdownRenderer
						currentUsername={users[currentUserId]?.username}
						markdown={post.message}
						resolveImageSrc={resolveImageSrc}
						useNewComposer={useNewComposer}
					/>
					<MessageAttachments
						files={post.metadata?.files ?? []}
						resolveImageSrc={resolveImageSrc}
						onOpenAttachment={onOpenAttachment}
					/>
					{groupedReactions.length > 0 ? (
						<div className="reaction-list">
							{groupedReactions.map((reaction) => (
								<ReactionPill
									key={reaction.emojiName}
									reaction={reaction}
									users={users}
									onClick={() =>
										void onToggleReaction(post, reaction.emojiName)
									}
								/>
							))}
						</div>
					) : null}
				</>
			)}
			{!deleted ? (
				<button
					aria-label="Reply"
					className="reply-message-reply-add"
					type="button"
					onClick={() => onReply(post)}
				>
					<Reply size={13} />
				</button>
			) : null}
			{!deleted ? (
				<EmojiPickerPopover
					label="Add reaction"
					onSelectEmoji={(_, emojiName) =>
						void onToggleReaction(post, normalizeEmojiName(emojiName))
					}
				>
					<button
						aria-label="Add reaction"
						className="reply-reaction-add"
						type="button"
					>
						<SmilePlus size={14} />
					</button>
				</EmojiPickerPopover>
			) : null}
		</div>
	);
});
