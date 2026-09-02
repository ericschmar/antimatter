import { useVirtualizer } from "@tanstack/react-virtual";
import type { CSSProperties } from "react";
import {
	memo,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	MattermostFileInfo,
	MattermostPost,
	MattermostUser,
	MattermostUserStatus,
} from "../types";
import { userLabel } from "../utils/format";
import { buildTimelineRows } from "../utils/timeline";
import { MessageRow } from "./MessageRow";
import "./MessageTimeline.css";

export { MessageRow } from "./MessageRow";

const SCROLL_END_THRESHOLD = 96;
type MessageVirtualizerInstance = {
	scrollDirection: "forward" | "backward" | null;
	measurementsCache: Array<{ size: number }>;
};

function measureMessageTimelineElement(
	element: HTMLElement,
	_entry: ResizeObserverEntry | undefined,
	instance: MessageVirtualizerInstance,
) {
	const index = Number(element.dataset["index"]);

	const cachedSize = Number.isFinite(index)
		? instance.measurementsCache[index]?.size
		: undefined;

	if (instance.scrollDirection === "backward" && cachedSize) {
		return cachedSize;
	}

	return element.getBoundingClientRect().height;
}

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
	ownMessageIndicatorColor,
	showOwnMessageIndicators,
	showProfilePictures,
	useNewComposer,
	typingUsers,
	onOpenAttachment,
	onShowMessageContextMenu,
	onSetUserColor,
	onStartDm,
	onReply,
	onToggleReaction,
	onVotePoll,
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
	ownMessageIndicatorColor: string;
	showOwnMessageIndicators: boolean;
	showProfilePictures: boolean;
	useNewComposer: boolean;
	typingUsers: MattermostUser[];
	onOpenAttachment: (file: MattermostFileInfo) => Promise<void>;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSetUserColor: (userId: string, color: string) => void;
	onStartDm: (userId: string) => void;
	onReply: (post: MattermostPost) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onVotePoll: (post: MattermostPost, optionId: string) => Promise<void>;
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
	const virtualizer = useVirtualizer({
		count: timelineRows.length,
		getScrollElement: () => viewportRef.current,
		getItemKey: (index) => timelineRows[index].key,
		estimateSize: (index) =>
			timelineRows[index].type === "divider" ? 34 : 112,
		measureElement: measureMessageTimelineElement,
		overscan: 12,
	});
	const lastPost = posts.at(-1);
	const lastPostId = lastPost?.id;
	const firstRowKey = timelineRows[0]?.key;
	const lastRowKey = timelineRows.at(-1)?.key;

	function scrollToEnd() {
		if (timelineRows.length > 0) {
			virtualizer.scrollToIndex(timelineRows.length - 1, { align: "end" });
			return;
		}

		const viewport = viewportRef.current;
		if (viewport) scrollToTimelineEnd(viewport);
	}

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

		if (shouldScrollToEnd) scrollToEnd();
		else if (prependedHistory) {
			virtualizer.measure();
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
		virtualizer,
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
			if (isAtEndRef.current) scrollToEnd();
			previousScrollHeightRef.current = viewport.scrollHeight;
			previousScrollTopRef.current = viewport.scrollTop;
		});
		resizeObserver.observe(list);
		return () => resizeObserver.disconnect();
	}, [timelineRows.length, virtualizer]);

	useEffect(() => {
		function handleReturnToApp() {
			if (document.hidden) return;
			const viewport = viewportRef.current;
			if (!viewport || !isAtEndRef.current) return;
			scrollToEnd();
			previousScrollHeightRef.current = viewport.scrollHeight;
			previousScrollTopRef.current = viewport.scrollTop;
		}

		document.addEventListener("visibilitychange", handleReturnToApp);
		window.addEventListener("focus", handleReturnToApp);
		return () => {
			document.removeEventListener("visibilitychange", handleReturnToApp);
			window.removeEventListener("focus", handleReturnToApp);
		};
	}, [timelineRows.length, virtualizer]);

	return (
		<div
			className="message-scroll mui-message-list-scroller"
			ref={viewportRef}
			style={
				{
					"--own-message-indicator-color": ownMessageIndicatorColor,
				} as CSSProperties
			}
		>
			<div className="message-list" ref={listRef}>
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
				{loading ? (
					<div className="timeline-state">Loading channel...</div>
				) : null}
				{!loading && posts.length === 0 ? (
					<div className="timeline-state">No messages in this channel.</div>
				) : null}
				{timelineRows.length > 0 ? (
					<div
						className="message-virtualizer"
						style={{ height: virtualizer.getTotalSize() }}
					>
						{virtualizer.getVirtualItems().map((virtualRow) => {
							const row = timelineRows[virtualRow.index];

							return (
								<div
									className="message-row"
									data-index={virtualRow.index}
									data-message-list-row=""
									data-message-id={
										row.type === "message" ? row.post.id : undefined
									}
									key={row.key}
									ref={virtualizer.measureElement}
									style={{ transform: `translateY(${virtualRow.start}px)` }}
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
											showOwnMessageIndicators={showOwnMessageIndicators}
											showProfilePictures={showProfilePictures}
											useNewComposer={useNewComposer}
											onOpenAttachment={onOpenAttachment}
											onShowMessageContextMenu={onShowMessageContextMenu}
											onSetUserColor={onSetUserColor}
											onStartDm={onStartDm}
											onReply={onReply}
											onToggleReaction={onToggleReaction}
											onVotePoll={onVotePoll}
										/>
									)}
								</div>
							);
						})}
					</div>
				) : null}
			</div>
			{!loading && typingUsers.length > 0 ? (
				<TypingIndicator users={typingUsers} />
			) : null}
		</div>
	);
}

function isTimelineAtEnd(viewport: HTMLDivElement) {
	return (
		viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <=
		SCROLL_END_THRESHOLD
	);
}

function scrollToTimelineEnd(viewport: HTMLDivElement) {
	viewport.scrollTop = viewport.scrollHeight;
}

const TypingIndicator = memo(function TypingIndicator({
	users,
}: {
	users: MattermostUser[];
}) {
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
});

function typingLabel(users: MattermostUser[]) {
	if (users.length === 1)
		return `${userLabel(users[0], users[0].id)} is typing`;
	if (users.length === 2) {
		return `${userLabel(users[0], users[0].id)} and ${userLabel(users[1], users[1].id)} are typing`;
	}
	return `${userLabel(users[0], users[0].id)} and ${users.length - 1} others are typing`;
}
