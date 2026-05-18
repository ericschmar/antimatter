import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText, MessageCircle, Reply, SmilePlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MattermostFileInfo, MattermostPost, MattermostReaction, MattermostUser, MattermostUserStatus } from "../types";
import { formatTime, initials, userLabel } from "../utils/format";
import { emojiNameToGlyph, normalizeEmojiName } from "../utils/emoji";
import { buildTimelineRows } from "../utils/timeline";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import { MarkdownMessage, useImageLoadState, useResolvedImageSrc } from "./MarkdownMessage";
import "./MessageTimeline.css";

export function MessageTimeline({
	posts,
	currentUserId,
	users,
	userColors,
	userImages,
	userStatuses,
	loading,
	loadingHistory,
	resolveImageSrc,
	onShowMessageContextMenu,
	onReply,
	onToggleReaction,
	onLoadMore,
}: {
	posts: MattermostPost[];
	currentUserId: string;
	users: Record<string, MattermostUser>;
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	loading: boolean;
	loadingHistory?: boolean;
	resolveImageSrc: (src: string) => Promise<string>;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onReply: (post: MattermostPost) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onLoadMore?: () => void;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const previousPostCountRef = useRef(0);
	const [showLoadMore, setShowLoadMore] = useState(false);
	const timelineRows = useMemo(() => buildTimelineRows(posts), [posts]);
	const rowVirtualizer = useVirtualizer({
		count: timelineRows.length,
		getScrollElement: () => viewportRef.current,
		estimateSize: (index) => (timelineRows[index]?.type === "divider" ? 30 : 34),
		getItemKey: (index) => timelineRows[index]?.key ?? index,
		overscan: 16,
	});
	const virtualRows = rowVirtualizer.getVirtualItems();

	useEffect(() => {
		if (timelineRows.length === 0) return;
		const viewport = viewportRef.current;
		const previousPostCount = previousPostCountRef.current;
		previousPostCountRef.current = posts.length;

		if (!viewport) return;
		const distanceFromBottom =
			viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
		const shouldStickToBottom = previousPostCount === 0 || distanceFromBottom < 96;

		if (shouldStickToBottom) {
			requestAnimationFrame(() => {
				rowVirtualizer.scrollToIndex(timelineRows.length - 1, { align: "end" });
			});
		}
	}, [posts.length, rowVirtualizer, timelineRows.length]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport || !onLoadMore) return;

		function handleScroll() {
			if (!viewport) return;
			const scrollTop = viewport.scrollTop;
			// Show button when scrolled within 300px of the top
			setShowLoadMore(scrollTop < 300);
		}

		// Check initial state
		handleScroll();

		viewport.addEventListener("scroll", handleScroll);
		return () => viewport.removeEventListener("scroll", handleScroll);
	}, [onLoadMore]);

	return (
		<div className="message-scroll" ref={viewportRef}>
			<div
				className="message-list"
				style={{
					height: `${rowVirtualizer.getTotalSize()}px`,
				}}
			>
				{!loading && posts.length > 0 && onLoadMore && showLoadMore ? (
					<button 
						className="load-more-button" 
						disabled={loadingHistory}
						type="button"
						onClick={onLoadMore}
					>
						{loadingHistory ? "Loading..." : "Load more messages"}
					</button>
				) : null}
				{loading ? <div className="timeline-state">Loading channel...</div> : null}
				{!loading && posts.length === 0 ? (
					<div className="timeline-state">No messages in this channel.</div>
				) : null}
				{virtualRows.map((virtualRow) => {
					const row = timelineRows[virtualRow.index];
					if (!row) return null;
					return (
						<div
							className="virtual-row"
							data-index={virtualRow.index}
							key={virtualRow.key}
							ref={rowVirtualizer.measureElement}
							style={{
								transform: `translateY(${virtualRow.start}px)`,
							}}
						>
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
									onShowMessageContextMenu={onShowMessageContextMenu}
									onReply={onReply}
									onToggleReaction={onToggleReaction}
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
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
	onShowMessageContextMenu,
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
	onShowMessageContextMenu: (post: MattermostPost) => void;
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
				<MessageAttachments files={post.metadata?.files ?? []} resolveImageSrc={resolveImageSrc} />
				{groupedReactions.length > 0 ? (
					<div className="reaction-list">
						{groupedReactions.map((reaction) => (
							<button
								className={reaction.mine ? "reaction-pill mine" : "reaction-pill"}
								key={reaction.emojiName}
								type="button"
								onClick={() => void onToggleReaction(post, reaction.emojiName)}
							>
								<span>{emojiNameToGlyph(reaction.emojiName)}</span>
								<span>{reaction.count}</span>
							</button>
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
								userStatuses={userStatuses}
								users={users}
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
	userStatuses,
	users,
	onToggleReaction,
}: {
	currentUserId: string;
	post: MattermostPost;
	resolveImageSrc: (src: string) => Promise<string>;
	userColor?: string;
	userStatuses: Record<string, MattermostUserStatus>;
	users: Record<string, MattermostUser>;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
}) {
	const author = users[post.user_id];
	const label = post.user_id === currentUserId ? "You" : userLabel(author, post.user_id);
	const groupedReactions = groupReactions(post.metadata?.reactions ?? [], currentUserId);
	const status = userStatuses[post.user_id]?.status;
	return (
		<div className="reply-message">
			<div className="reply-message-meta">
				<UserStatusDot inline status={status} />
				<span
					className="reply-message-author"
					style={userColor ? { color: userColor } : undefined}
				>
					{label}
				</span>
				<time>{formatTime(post.create_at)}</time>
			</div>
			<MarkdownMessage currentUsername={users[currentUserId]?.username} markdown={post.message} resolveImageSrc={resolveImageSrc} />
			<MessageAttachments files={post.metadata?.files ?? []} resolveImageSrc={resolveImageSrc} />
			{groupedReactions.length > 0 ? (
				<div className="reaction-list">
					{groupedReactions.map((reaction) => (
						<button
							className={reaction.mine ? "reaction-pill mine" : "reaction-pill"}
							key={reaction.emojiName}
							type="button"
							onClick={() => void onToggleReaction(post, reaction.emojiName)}
						>
							<span>{emojiNameToGlyph(reaction.emojiName)}</span>
							<span>{reaction.count}</span>
						</button>
					))}
				</div>
			) : null}
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
}: {
	files: MattermostFileInfo[];
	resolveImageSrc: (src: string) => Promise<string>;
}) {
	const imageFiles = files.filter(isImageFile);
	const otherFiles = files.filter((file) => !isImageFile(file));
	if (files.length === 0) return null;
	return (
		<div className="message-attachments">
			{imageFiles.map((file) => (
				<InlineImageAttachment file={file} key={file.id} resolveImageSrc={resolveImageSrc} />
			))}
			{otherFiles.map((file) => (
				<FileAttachment file={file} key={file.id} resolveImageSrc={resolveImageSrc} />
			))}
		</div>
	);
}

function InlineImageAttachment({
	file,
	resolveImageSrc,
}: {
	file: MattermostFileInfo;
	resolveImageSrc: (src: string) => Promise<string>;
}) {
	const src = useResolvedImageSrc(`/files/${encodeURIComponent(file.id)}`, resolveImageSrc);
	const loadState = useImageLoadState(src);
	return (
		<a
			className="inline-image-link"
			href={src ?? undefined}
			rel="noreferrer"
			target="_blank"
		>
			{src && loadState === "loaded" ? (
				<img alt={file.name ?? "Attached image"} className="inline-image" loading="lazy" src={src} />
			) : src && loadState === "failed" ? (
				<span className="inline-image-loading">{file.name ?? "Open image"}</span>
			) : (
				<span className="inline-image-loading">{file.name ?? "Loading image..."}</span>
			)}
		</a>
	);
}

function FileAttachment({
	file,
	resolveImageSrc,
}: {
	file: MattermostFileInfo;
	resolveImageSrc: (src: string) => Promise<string>;
}) {
	const src = useResolvedImageSrc(`/files/${encodeURIComponent(file.id)}`, resolveImageSrc);
	return (
		<a className="file-attachment" href={src ?? undefined} rel="noreferrer" target="_blank">
			<FileText size={16} />
			<span>{file.name ?? file.id}</span>
		</a>
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
	userColor,
	user,
}: {
	currentUserId: string;
	fallback: string;
	imageSrc?: string;
	status?: string;
	userColor?: string;
	user: MattermostUser | undefined;
}) {
	const label = fallback === currentUserId ? "You" : userLabel(user, fallback);
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				className="message-author"
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

function groupReactions(reactions: MattermostReaction[], currentUserId: string) {
	const groups = new Map<string, { emojiName: string; count: number; mine: boolean }>();
	for (const reaction of reactions) {
		const existing = groups.get(reaction.emoji_name);
		if (existing) {
			existing.count += 1;
			if (reaction.user_id === currentUserId) existing.mine = true;
			continue;
		}
		groups.set(reaction.emoji_name, {
			emojiName: reaction.emoji_name,
			count: 1,
			mine: reaction.user_id === currentUserId,
		});
	}
	return [...groups.values()];
}
