import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { FileText, MessageCircle, Reply, SmilePlus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MattermostFileInfo, MattermostPost, MattermostReaction, MattermostUser, MattermostUserStatus } from "../types";
import { formatTime, initials, userLabel } from "../utils/format";
import { emojiNameToGlyph, normalizeEmojiName } from "../utils/emoji";
import { buildTimelineRows } from "../utils/timeline";
import { USER_COLOR_PALETTE } from "../utils/userColors";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import { MarkdownMessage, useImageLoadInfo, useResolvedImageSrc } from "./MarkdownMessage";
import "./MessageTimeline.css";

const SCROLL_END_THRESHOLD = 96;

export function MessageTimeline({
	posts,
	channelId,
	currentUserId,
	users,
	userColors,
	userImages,
	userStatuses,
	loading,
	loadingHistory,
	resolveImageSrc,
	typingUsers,
	onOpenAttachment,
	onShowMessageContextMenu,
	onSetUserColor,
	onReply,
	onToggleReaction,
	onLoadMore,
}: {
	posts: MattermostPost[];
	channelId: string | null;
	currentUserId: string;
	users: Record<string, MattermostUser>;
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	loading: boolean;
	loadingHistory?: boolean;
	resolveImageSrc: (src: string) => Promise<string>;
	typingUsers: MattermostUser[];
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onReply: (post: MattermostPost) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onLoadMore?: () => void;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const previousChannelIdRef = useRef<string | null>(null);
	const previousLastPostIdRef = useRef<string | undefined>(undefined);
	const previousFirstRowKeyRef = useRef<string | undefined>(undefined);
	const previousLastRowKeyRef = useRef<string | undefined>(undefined);
	const previousScrollHeightRef = useRef(0);
	const previousScrollTopRef = useRef(0);
	const isAtEndRef = useRef(true);
	const [showLoadMore, setShowLoadMore] = useState(false);
	const timelineRows = useMemo(() => buildTimelineRows(posts), [posts]);
	const lastPost = posts.at(-1);
	const lastPostId = lastPost?.id;
	const firstRowKey = timelineRows[0]?.key;
	const lastRowKey = timelineRows.at(-1)?.key;

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;

		const previousChannelId = previousChannelIdRef.current;
		const previousLastPostId = previousLastPostIdRef.current;
		const previousFirstRowKey = previousFirstRowKeyRef.current;
		const previousLastRowKey = previousLastRowKeyRef.current;
		const channelChanged = previousChannelId !== channelId;
		const newestPostChanged =
			Boolean(previousLastPostId) &&
			Boolean(lastPostId) &&
			previousLastPostId !== lastPostId;
		const channelContentLoaded =
			!channelChanged &&
			previousChannelId === channelId &&
			!previousLastPostId &&
			Boolean(lastPostId);
		const newestPostIsMine = lastPost?.user_id === currentUserId;
		const prependedHistory =
			!channelChanged &&
			Boolean(previousFirstRowKey) &&
			Boolean(firstRowKey) &&
			previousFirstRowKey !== firstRowKey &&
			previousLastRowKey === lastRowKey;
		const shouldScrollToEnd =
			channelChanged ||
			channelContentLoaded ||
			(newestPostChanged && (newestPostIsMine || isAtEndRef.current));

		if (shouldScrollToEnd) scrollToTimelineEnd(viewport);
		else if (prependedHistory) {
			const scrollHeightDelta =
				viewport.scrollHeight - previousScrollHeightRef.current;
			viewport.scrollTop = previousScrollTopRef.current + scrollHeightDelta;
		}

		previousChannelIdRef.current = channelId;
		previousLastPostIdRef.current = lastPostId;
		previousFirstRowKeyRef.current = firstRowKey;
		previousLastRowKeyRef.current = lastRowKey;
		isAtEndRef.current = isTimelineAtEnd(viewport);
		previousScrollHeightRef.current = viewport.scrollHeight;
		previousScrollTopRef.current = viewport.scrollTop;
	}, [
		channelId,
		currentUserId,
		firstRowKey,
		lastPost?.user_id,
		lastPostId,
		lastRowKey,
		timelineRows.length,
	]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;

		function handleScroll() {
			if (!viewport) return;
			const scrollTop = viewport.scrollTop;
			isAtEndRef.current = isTimelineAtEnd(viewport);
			previousScrollHeightRef.current = viewport.scrollHeight;
			previousScrollTopRef.current = scrollTop;
			setShowLoadMore(Boolean(onLoadMore) && scrollTop < 300);
		}

		handleScroll();

		viewport.addEventListener("scroll", handleScroll);
		return () => viewport.removeEventListener("scroll", handleScroll);
	}, [onLoadMore]);

	useEffect(() => {
		const viewport = viewportRef.current;
		const list = listRef.current;
		if (!viewport || !list || !window.ResizeObserver) return;

		const resizeObserver = new ResizeObserver(() => {
			if (isAtEndRef.current) scrollToTimelineEnd(viewport);
			previousScrollHeightRef.current = viewport.scrollHeight;
			previousScrollTopRef.current = viewport.scrollTop;
		});
		resizeObserver.observe(list);
		return () => resizeObserver.disconnect();
	}, []);

	function loadMoreFromTop() {
		onLoadMore?.();
	}

	return (
		<div className="message-scroll" ref={viewportRef}>
			<div className="message-list" ref={listRef}>
				{!loading && posts.length > 0 && onLoadMore && showLoadMore ? (
					<button
						className="load-more-button"
						disabled={loadingHistory}
						type="button"
						onClick={loadMoreFromTop}
					>
						{loadingHistory ? "Loading..." : "Load more messages"}
					</button>
				) : null}
				{loading ? <div className="timeline-state">Loading channel...</div> : null}
				{!loading && posts.length === 0 ? (
					<div className="timeline-state">No messages in this channel.</div>
				) : null}
				{timelineRows.map((row) => {
					return (
						<div className="message-row" key={row.key}>
							{row.type === "divider" ? (
								<div className="date-divider">
									<span>{row.label}</span>
								</div>
							) : (
								<MessageRow
									currentUserId={currentUserId}
									post={row.post}
									replies={row.replies}
									userColor={userColors[row.post.user_id]}
									userColors={userColors}
									userImages={userImages}
									userStatuses={userStatuses}
									users={users}
									resolveImageSrc={resolveImageSrc}
									onOpenAttachment={onOpenAttachment}
									onShowMessageContextMenu={onShowMessageContextMenu}
									onSetUserColor={onSetUserColor}
									onReply={onReply}
									onToggleReaction={onToggleReaction}
								/>
							)}
						</div>
					);
				})}
			</div>
			{!loading && typingUsers.length > 0 ? (
				<TypingIndicator users={typingUsers} />
			) : null}
		</div>
	);
}

function isTimelineAtEnd(viewport: HTMLDivElement) {
	return (
		viewport.scrollHeight -
			viewport.clientHeight -
			viewport.scrollTop <=
		SCROLL_END_THRESHOLD
	);
}

function scrollToTimelineEnd(viewport: HTMLDivElement) {
	viewport.scrollTop = viewport.scrollHeight;
}

function TypingIndicator({ users }: { users: MattermostUser[] }) {
	return (
		<div className="typing-indicator" role="status" aria-live="polite">
			<span className="typing-dots" aria-hidden="true">
				<span />
				<span />
				<span />
			</span>
			<span>{typingLabel(users)}</span>
		</div>
	);
}

function typingLabel(users: MattermostUser[]) {
	if (users.length === 1) return `${userLabel(users[0], users[0].id)} is typing`;
	if (users.length === 2) {
		return `${userLabel(users[0], users[0].id)} and ${userLabel(users[1], users[1].id)} are typing`;
	}
	return `${userLabel(users[0], users[0].id)} and ${users.length - 1} others are typing`;
}

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
	onOpenAttachment,
	onShowMessageContextMenu,
	onSetUserColor,
	onReply,
	onToggleReaction,
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
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onReply: (post: MattermostPost) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
}) {
	const author = users[post.user_id];
	const groupedReactions = groupReactions(post.metadata?.reactions ?? [], currentUserId);
	const canReply = !post.root_id || post.root_id === post.id;
	const authorStatus = userStatuses[post.user_id]?.status;
	return (
		<article
			className={post.user_id === currentUserId ? "message own" : "message"}
			onContextMenu={(event) => {
				event.preventDefault();
				onShowMessageContextMenu(post);
			}}
		>
			<div className="message-meta">
				<UserDetailsTrigger
					currentUserId={currentUserId}
					fallback={post.user_id}
					imageSrc={userImages[post.user_id]}
					status={authorStatus}
					userColor={userColor}
					user={author}
					onSetUserColor={onSetUserColor}
				/>
				<time>{formatTime(post.create_at)}</time>
				{post.pending ? <span className="message-state">sending</span> : null}
				{post.failed ? <span className="message-state failed">failed</span> : null}
			</div>
			<div className="message-content">
				<MarkdownMessage
					currentUsername={users[currentUserId]?.username}
					markdown={post.message}
					resolveImageSrc={resolveImageSrc}
				/>
				<MessageAttachments files={post.metadata?.files ?? []} resolveImageSrc={resolveImageSrc} onOpenAttachment={onOpenAttachment} />
				{groupedReactions.length > 0 ? (
					<div className="reaction-list">
						{groupedReactions.map((reaction) => (
							<ReactionPill
								key={reaction.emojiName}
								reaction={reaction}
								users={users}
								onClick={() => void onToggleReaction(post, reaction.emojiName)}
							/>
						))}
					</div>
				) : null}
				{replies.length > 0 ? (
					<div className="message-replies">
						{replies.map((reply) => (
							<ReplyMessage
								currentUserId={currentUserId}
								key={reply.id}
								post={reply}
								resolveImageSrc={resolveImageSrc}
								userColor={userColors[reply.user_id]}
								userImages={userImages}
								userStatuses={userStatuses}
								users={users}
								onOpenAttachment={onOpenAttachment}
								onReply={onReply}
								onSetUserColor={onSetUserColor}
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
			<EmojiPickerPopover
				label="Add reaction"
				onSelectEmoji={(_, emojiName) => void onToggleReaction(post, normalizeEmojiName(emojiName))}
			>
				<button aria-label="Add reaction" className="message-reaction-add" type="button">
					<SmilePlus size={14} />
				</button>
			</EmojiPickerPopover>
		</article>
	);
}

function ReplyMessage({
	currentUserId,
	post,
	resolveImageSrc,
	userColor,
	userImages,
	userStatuses,
	users,
	onOpenAttachment,
	onReply,
	onSetUserColor,
	onToggleReaction,
}: {
	currentUserId: string;
	post: MattermostPost;
	resolveImageSrc: (src: string) => Promise<string>;
	userColor?: string;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	users: Record<string, MattermostUser>;
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onReply: (post: MattermostPost) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
}) {
	const author = users[post.user_id];
	const groupedReactions = groupReactions(post.metadata?.reactions ?? [], currentUserId);
	const status = userStatuses[post.user_id]?.status;
	return (
		<div className="reply-message">
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
				/>
				<time>{formatTime(post.create_at)}</time>
			</div>
			<MarkdownMessage currentUsername={users[currentUserId]?.username} markdown={post.message} resolveImageSrc={resolveImageSrc} />
			<MessageAttachments files={post.metadata?.files ?? []} resolveImageSrc={resolveImageSrc} onOpenAttachment={onOpenAttachment} />
			{groupedReactions.length > 0 ? (
				<div className="reaction-list">
					{groupedReactions.map((reaction) => (
						<ReactionPill
							key={reaction.emojiName}
							reaction={reaction}
							users={users}
							onClick={() => void onToggleReaction(post, reaction.emojiName)}
						/>
					))}
				</div>
			) : null}
			<button
				aria-label="Reply"
				className="reply-message-reply-add"
				type="button"
				onClick={() => onReply(post)}
			>
				<Reply size={13} />
			</button>
			<EmojiPickerPopover
				label="Add reaction"
				onSelectEmoji={(_, emojiName) => void onToggleReaction(post, normalizeEmojiName(emojiName))}
			>
				<button aria-label="Add reaction" className="reply-reaction-add" type="button">
					<SmilePlus size={14} />
				</button>
			</EmojiPickerPopover>
		</div>
	);
}

function MessageAttachments({
	files,
	resolveImageSrc,
	onOpenAttachment,
}: {
	files: MattermostFileInfo[];
	resolveImageSrc: (src: string) => Promise<string>;
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
}) {
	const [openingFileId, setOpeningFileId] = useState<string | null>(null);
	const imageFiles = files.filter(isImageFile);
	const otherFiles = files.filter((file) => !isImageFile(file));
	if (files.length === 0) return null;
	async function openAttachment(file: MattermostFileInfo) {
		if (openingFileId) return;
		setOpeningFileId(file.id);
		try {
			await onOpenAttachment(file);
		} finally {
			setOpeningFileId(null);
		}
	}
	return (
		<div className="message-attachments">
			{imageFiles.map((file) => (
				<InlineImageAttachment
					file={file}
					key={file.id}
					opening={openingFileId === file.id}
					resolveImageSrc={resolveImageSrc}
					onOpen={() => void openAttachment(file)}
				/>
			))}
			{otherFiles.map((file) => (
				<FileAttachment
					file={file}
					key={file.id}
					opening={openingFileId === file.id}
					onOpen={() => void openAttachment(file)}
				/>
			))}
		</div>
	);
}

function InlineImageAttachment({
	file,
	opening,
	resolveImageSrc,
	onOpen,
}: {
	file: MattermostFileInfo;
	opening: boolean;
	resolveImageSrc: (src: string) => Promise<string>;
	onOpen: () => void;
}) {
	const src = useResolvedImageSrc(`/files/${encodeURIComponent(file.id)}`, resolveImageSrc);
	const loadInfo = useImageLoadInfo(src);
	return (
		<button
			aria-label={`Open ${file.name ?? "attached image"}`}
			className="inline-image-link"
			disabled={opening}
			type="button"
			onClick={onOpen}
		>
			{src && loadInfo.state === "loaded" ? (
				<span
					className="inline-image-frame loaded"
					style={{
						aspectRatio: loadInfo.width / loadInfo.height,
						width: Math.min(loadInfo.width, 520),
					}}
				>
					<img alt={file.name ?? "Attached image"} className="inline-image" loading="lazy" src={src} />
				</span>
			) : src && loadInfo.state === "failed" ? (
				<span className="inline-image-loading">{opening ? "Opening..." : file.name ?? "Open image"}</span>
			) : (
				<span className="inline-image-loading">{opening ? "Opening..." : file.name ?? "Loading image..."}</span>
			)}
		</button>
	);
}

function FileAttachment({
	file,
	opening,
	onOpen,
}: {
	file: MattermostFileInfo;
	opening: boolean;
	onOpen: () => void;
}) {
	return (
		<button className="file-attachment" disabled={opening} type="button" onClick={onOpen}>
			<FileText size={16} />
			<span>{opening ? "Opening..." : file.name ?? file.id}</span>
		</button>
	);
}

function isImageFile(file: MattermostFileInfo) {
	const mimeType = file.mime_type?.toLowerCase() ?? "";
	const extension = file.extension?.toLowerCase() || file.name?.split(".").pop()?.toLowerCase() || "";
	return (
		mimeType.startsWith("image/") ||
		["gif", "jpg", "jpeg", "png", "webp", "avif"].includes(extension) ||
		file.has_preview_image === true
	);
}

function UserDetailsTrigger({
	currentUserId,
	fallback,
	imageSrc,
	status,
	triggerClassName = "message-author",
	userColor,
	user,
	onSetUserColor,
}: {
	currentUserId: string;
	fallback: string;
	imageSrc?: string;
	status?: string;
	triggerClassName?: string;
	userColor?: string;
	user: MattermostUser | undefined;
	onSetUserColor: (userId: string, color: string) => void;
}) {
	const label = fallback === currentUserId ? "You" : userLabel(user, fallback);
	const selectedColor = userColor ?? USER_COLOR_PALETTE[0];
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				className={triggerClassName}
				style={userColor ? { color: userColor } : undefined}
				type="button"
			>
				<UserStatusDot inline status={status} />
				<span className="message-author-name">{label}</span>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content className="user-popover" sideOffset={6}>
					<div className="user-popover-header">
						<div className="user-avatar">
							{imageSrc ? <img alt="" src={imageSrc} /> : initials(user?.nickname || user?.username || fallback)}
							<UserStatusDot status={status} />
						</div>
						<div>
							<p>{label}</p>
							<span>{user?.username ? `@${user.username}` : fallback}</span>
							<span>{status ?? "offline"}</span>
						</div>
					</div>
					{user?.position ? <p className="user-popover-detail">{user.position}</p> : null}
					<DropdownMenu.Separator className="dropdown-separator" />
					<div className="user-color-section">
						<p>Color</p>
						<div className="user-color-grid">
							{USER_COLOR_PALETTE.map((color) => (
								<button
									aria-label={`Use ${color}`}
									aria-pressed={color.toLowerCase() === userColor?.toLowerCase()}
									className="user-color-swatch"
									key={color}
									style={{ backgroundColor: color }}
									type="button"
									onClick={() => onSetUserColor(fallback, color)}
								/>
							))}
						</div>
						<label className="user-color-custom">
							<span>Custom</span>
							<input
								type="color"
								value={selectedColor}
								onChange={(event) => onSetUserColor(fallback, event.currentTarget.value)}
							/>
						</label>
					</div>
					<DropdownMenu.Separator className="dropdown-separator" />
					<DropdownMenu.Item className="dropdown-item" disabled>
						<MessageCircle size={14} />
						Start DM
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

function UserStatusDot({ inline = false, status }: { inline?: boolean; status?: string }) {
	return <span className={`status-dot ${inline ? "inline" : ""} ${status ?? "offline"}`} title={status ?? "offline"} />;
}

type GroupedReaction = {
	emojiName: string;
	count: number;
	mine: boolean;
	userIds: string[];
};

function ReactionPill({
	reaction,
	users,
	onClick,
}: {
	reaction: GroupedReaction;
	users: Record<string, MattermostUser>;
	onClick: () => void;
}) {
	const glyph = emojiNameToGlyph(reaction.emojiName);
	const reactionUsers = reaction.userIds.map((userId) => userLabel(users[userId], userId));
	const tooltipLabel = `${formatReactionUsers(reactionUsers)} reacted with ${glyph}`;

	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<button
					aria-label={tooltipLabel}
					className={reaction.mine ? "reaction-pill mine" : "reaction-pill"}
					type="button"
					onClick={onClick}
				>
					<span>{glyph}</span>
					<span>{reaction.count}</span>
				</button>
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content className="tooltip-content reaction-tooltip" side="top" sideOffset={6}>
					{tooltipLabel}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}

function groupReactions(reactions: MattermostReaction[], currentUserId: string) {
	const groups = new Map<string, GroupedReaction>();
	for (const reaction of reactions) {
		const existing = groups.get(reaction.emoji_name);
		if (existing) {
			existing.count += 1;
			if (reaction.user_id === currentUserId) existing.mine = true;
			if (!existing.userIds.includes(reaction.user_id)) existing.userIds.push(reaction.user_id);
			continue;
		}
		groups.set(reaction.emoji_name, {
			emojiName: reaction.emoji_name,
			count: 1,
			mine: reaction.user_id === currentUserId,
			userIds: [reaction.user_id],
		});
	}
	return [...groups.values()];
}

function formatReactionUsers(names: string[]) {
	if (names.length <= 2) return names.join(" and ");
	return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}
