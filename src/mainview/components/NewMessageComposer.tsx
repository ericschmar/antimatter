import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { Paperclip, Send, SmilePlus, Sticker, X } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { DragEvent, KeyboardEvent } from "react";
import type { MattermostUser } from "../types";
import { initials, userLabel } from "../utils/format";
import { normalizeOutgoingMessage } from "../utils/outgoingMessage";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import { GiphyPickerPopover } from "./GiphyPickerPopover";
import type { GiphyGif } from "./GiphyPickerPopover";
import { MarkdownMessage } from "./MarkdownMessage";
import type { MessageComposerHandle, MessageComposerProps } from "./MessageComposer";
import { buildMentionInsertion, matchMentionQuery } from "./mentions";
import "./NewMessageComposer.css";

const TYPING_UPDATE_INTERVAL_MS = 4000;
const MIN_CONTENT_HEIGHT = 72;
const COMPOSER_CHROME_PX = 18;

function giphyGifMarkdown(gif: GiphyGif) {
	const src =
		gif.images?.["original"]?.url ??
		gif.images?.["downsized_medium"]?.url ??
		gif.images?.["fixed_width"]?.url ??
		gif.images?.["fixed_width_downsampled"]?.url;
	if (!src) return null;
	const alt = (gif.title?.trim() || "GIPHY GIF").replace(/[\r\n[\]]/g, " ");
	return `![${alt}](${src})`;
}

export const NewMessageComposer = forwardRef<
	MessageComposerHandle,
	MessageComposerProps
>(function NewMessageComposer(
	{
		disabled,
		editTarget,
		giphyApiKey,
		mentionUsers,
		replyTarget,
		users,
		userColors,
		currentUserId,
		composerHeight,
		maxComposerHeight,
		onCancelEdit,
		onCancelReply,
		onEdit,
		onRequestComposerHeight,
		onSend,
		onTyping,
	},
	ref,
) {
	const [message, setMessage] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [activeMentionIndex, setActiveMentionIndex] = useState(0);
	const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
	const [giphyPickerOpen, setGiphyPickerOpen] = useState(false);
	const [fileAccept, setFileAccept] = useState<string | undefined>();
	const [sending, setSending] = useState(false);
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const messageRef = useRef("");
	const composerEditorRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const lastTypingUpdateRef = useRef(0);
	const mentionSuggestionRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const dragCounterRef = useRef(0);
	const canSend =
		!disabled && !sending && (message.trim().length > 0 || files.length > 0);
	const mentionMatch = useMemo(() => matchMentionQuery(message), [message]);
	const mentionSuggestions = useMemo(() => {
		if (!mentionMatch || disabled) return [];
		const query = mentionMatch.query.toLowerCase();
		return mentionUsers
			.filter((user) => user.id !== currentUserId)
			.filter((user) => {
				const label = userLabel(user, user.id).toLowerCase();
				return (
					user.username.toLowerCase().includes(query) ||
					label.includes(query) ||
					user.nickname?.toLowerCase().includes(query)
				);
			})
			.slice(0, 8);
	}, [currentUserId, disabled, mentionMatch, mentionUsers]);
	const showMentionSuggestions = mentionSuggestions.length > 0;

	const getTextarea = useCallback(
		() =>
			composerEditorRef.current?.querySelector<HTMLTextAreaElement>(
				"textarea",
			) ?? null,
		[],
	);

	const handleMessageChange = useCallback(
		(nextMessage: string) => {
			messageRef.current = nextMessage;
			setMessage(nextMessage);
			requestAnimationFrame(() => {
				const textarea = getTextarea();
				if (!textarea) return;
				const previousHeight = textarea.style.height;
				textarea.style.height = "auto";
				const contentHeight = textarea.scrollHeight;
				textarea.style.height = previousHeight;
				const next = Math.min(
					maxComposerHeight,
					Math.max(MIN_CONTENT_HEIGHT, contentHeight + COMPOSER_CHROME_PX),
				);
				if (next !== composerHeight) onRequestComposerHeight(next);
			});
			if (disabled || editTarget || nextMessage.trim().length === 0) return;

			const now = Date.now();
			if (now - lastTypingUpdateRef.current < TYPING_UPDATE_INTERVAL_MS) return;

			lastTypingUpdateRef.current = now;
			void onTyping(replyTarget?.root_id || replyTarget?.id);
		},
		[
			composerHeight,
			disabled,
			editTarget,
			getTextarea,
			maxComposerHeight,
			onRequestComposerHeight,
			onTyping,
			replyTarget?.id,
			replyTarget?.root_id,
		],
	);

	const insertAtCaret = useCallback(
		(text: string) => {
			const textarea = getTextarea();
			const start = textarea?.selectionStart ?? messageRef.current.length;
			const end = textarea?.selectionEnd ?? messageRef.current.length;
			const next =
				messageRef.current.slice(0, start) +
				text +
				messageRef.current.slice(end);
			const pos = start + text.length;
			messageRef.current = next;
			setMessage(next);
			requestAnimationFrame(() => {
				const ta = getTextarea();
				ta?.focus();
				ta?.setSelectionRange(pos, pos);
			});
		},
		[getTextarea],
	);

	const insertEmoji = useCallback(
		(emoji: string) => {
			if (disabled || !emoji) return;
			insertAtCaret(emoji);
		},
		[disabled, insertAtCaret],
	);

	const insertGif = useCallback(
		(gif: GiphyGif) => {
			const gifMarkdown = giphyGifMarkdown(gif);
			if (disabled || !gifMarkdown) return;
			const markdownToInsert =
				messageRef.current.trim().length > 0
					? `\n${gifMarkdown}\n`
					: gifMarkdown;
			insertAtCaret(markdownToInsert);
		},
		[disabled, insertAtCaret],
	);

	const insertMention = useCallback(
		(user: MattermostUser) => {
			if (!mentionMatch) return;
			const insertion = buildMentionInsertion(
				messageRef.current,
				mentionMatch,
				user.username,
			);
			messageRef.current = insertion.message;
			setMessage(insertion.message);
			setActiveMentionIndex(0);
			requestAnimationFrame(() => {
				const ta = getTextarea();
				ta?.focus();
				ta?.setSelectionRange(insertion.cursorPosition, insertion.cursorPosition);
			});
		},
		[getTextarea, mentionMatch],
	);

	const openFilePicker = useCallback(
		(accept?: string) => {
			if (disabled || editTarget) return;
			setFileAccept(accept);
			requestAnimationFrame(() => fileInputRef.current?.click());
		},
		[disabled, editTarget],
	);

	async function submit() {
		const normalizedMessage = normalizeOutgoingMessage(message.trim());
		if (sending || (!normalizedMessage && files.length === 0)) return;
		if (editTarget) {
			void onEdit(editTarget, normalizedMessage);
			lastTypingUpdateRef.current = 0;
			messageRef.current = "";
			setMessage("");
			return;
		}
		const rootId = replyTarget?.root_id || replyTarget?.id;
		const filesToSend = files;
		setSending(true);
		try {
			await onSend(normalizedMessage, rootId, filesToSend);
			lastTypingUpdateRef.current = 0;
			messageRef.current = "";
			setMessage("");
			setFiles([]);
			onCancelReply();
		} catch {
			// MainViewApp surfaces send errors; keep the draft intact for retry.
		} finally {
			setSending(false);
		}
	}

	function handleComposerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		// Capture phase: intercept before @uiw's handleKeyDown, which otherwise
		// swallows Tab entirely and Enter on list-marker lines.
		if (showMentionSuggestions) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				event.stopPropagation();
				setActiveMentionIndex((current) =>
					(current + 1) % mentionSuggestions.length,
				);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				event.stopPropagation();
				setActiveMentionIndex(
					(current) =>
						(current - 1 + mentionSuggestions.length) %
						mentionSuggestions.length,
				);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				event.stopPropagation();
				insertMention(mentionSuggestions[activeMentionIndex] ?? mentionSuggestions[0]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setActiveMentionIndex(-1);
				return;
			}
		}
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey
		) {
			event.preventDefault();
			event.stopPropagation();
			submit();
		}
	}

	const focusEditor = useCallback(() => {
		if (disabled) return;
		const textarea = getTextarea();
		textarea?.focus();
		const len = textarea?.value.length ?? 0;
		textarea?.setSelectionRange(len, len);
	}, [disabled, getTextarea]);

	const handleDragEnter = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			if (disabled || editTarget) return;
			event.preventDefault();
			event.stopPropagation();
			dragCounterRef.current += 1;
			if (event.dataTransfer.types.includes("Files")) {
				setIsDraggingOver(true);
			}
		},
		[disabled, editTarget],
	);

	const handleDragLeave = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			if (disabled || editTarget) return;
			event.preventDefault();
			event.stopPropagation();
			dragCounterRef.current -= 1;
			if (dragCounterRef.current === 0) {
				setIsDraggingOver(false);
			}
		},
		[disabled, editTarget],
	);

	const handleDragOver = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			if (disabled || editTarget) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "copy";
		},
		[disabled, editTarget],
	);

	const handleDrop = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			if (disabled || editTarget) return;
			event.preventDefault();
			event.stopPropagation();
			dragCounterRef.current = 0;
			setIsDraggingOver(false);

			const droppedFiles = Array.from(event.dataTransfer.files);
			if (droppedFiles.length > 0) {
				setFiles((current) => [...current, ...droppedFiles]);
			}
		},
		[disabled, editTarget],
	);

	useImperativeHandle(
		ref,
		() => ({
			attachFiles: () => openFilePicker(),
			attachImages: () => openFilePicker("image/*"),
			focus: focusEditor,
			openEmojiPicker: () => {
				if (disabled) return;
				setEmojiPickerOpen(true);
			},
		}),
		[disabled, focusEditor, openFilePicker],
	);

	useEffect(() => {
		if (disabled) return;
		const frame = requestAnimationFrame(focusEditor);
		return () => cancelAnimationFrame(frame);
	}, [disabled, focusEditor]);

	useEffect(() => {
		setActiveMentionIndex(0);
	}, [mentionMatch?.query]);

	useEffect(() => {
		if (!showMentionSuggestions || activeMentionIndex < 0) return;
		mentionSuggestionRefs.current[activeMentionIndex]?.scrollIntoView({
			block: "nearest",
		});
	}, [activeMentionIndex, showMentionSuggestions]);

	useEffect(() => {
		if (!editTarget) return;
		setFiles([]);
		messageRef.current = editTarget.message;
		setMessage(editTarget.message);
		requestAnimationFrame(focusEditor);
	}, [editTarget, focusEditor]);

	const replyAuthor = replyTarget ? users[replyTarget.user_id] : undefined;
	const replyLabel = replyTarget
		? replyTarget.user_id === currentUserId
			? "You"
			: userLabel(replyAuthor, replyTarget.user_id)
		: "";

	return (
		<div className="composer composer-new" onKeyDownCapture={handleComposerKeyDown}>
			<div
				className={
					disabled
						? "composer-editor disabled"
						: isDraggingOver
							? "composer-editor dragging"
							: "composer-editor"
				}
				ref={composerEditorRef}
				onClick={(event) => {
					const target = event.target as HTMLElement;
					if (target.closest("textarea, button, [role='toolbar']")) return;
					focusEditor();
				}}
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				<MDEditor
					hideToolbar
					highlightEnable={false}
					preview="edit"
					textareaProps={{ readOnly: disabled }}
					value={message}
					visibleDragbar={false}
					onChange={(value) => handleMessageChange(value ?? "")}
				/>
				{editTarget ? (
					<div className="composer-reply-target edit">
						<div className="composer-reply-copy">
							<span className="composer-reply-author">Editing message</span>
							<div className="composer-reply-preview">
								Press Enter to save changes.
							</div>
						</div>
						<button
							aria-label="Cancel edit"
							className="composer-reply-cancel"
							type="button"
							onClick={() => {
								messageRef.current = "";
								setMessage("");
								onCancelEdit();
							}}
						>
							<X size={14} />
						</button>
					</div>
				) : replyTarget ? (
					<div className="composer-reply-target">
						<div className="composer-reply-copy">
							<span
								className="composer-reply-author"
								style={
									userColors[replyTarget.user_id]
										? { color: userColors[replyTarget.user_id] }
										: undefined
								}
							>
								Replying to {replyLabel}
							</span>
							<div className="composer-reply-preview">
								<MarkdownMessage markdown={replyTarget.message} />
							</div>
						</div>
						<button
							aria-label="Cancel reply"
							className="composer-reply-cancel"
							type="button"
							onClick={onCancelReply}
						>
							<X size={14} />
						</button>
					</div>
				) : null}
				{files.length > 0 ? (
					<div className="composer-files">
						{files.map((file, index) => (
							<span
								className="composer-file-chip"
								key={`${file.name}-${index}`}
							>
								{file.name}
								<button
									aria-label={`Remove ${file.name}`}
									type="button"
									onClick={() =>
										setFiles((current) =>
											current.filter((_, fileIndex) => fileIndex !== index),
										)
									}
								>
									<X size={12} />
								</button>
							</span>
						))}
					</div>
				) : null}
			</div>
			{showMentionSuggestions && activeMentionIndex >= 0 ? (
				<div className="mention-suggestions" role="listbox">
					{mentionSuggestions.map((user, index) => (
						<button
							aria-selected={index === activeMentionIndex}
							className={
								index === activeMentionIndex
									? "mention-suggestion active"
									: "mention-suggestion"
							}
							key={user.id}
							ref={(element) => {
								mentionSuggestionRefs.current[index] = element;
							}}
							role="option"
							type="button"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => insertMention(user)}
						>
							<span className="mention-suggestion-avatar">
								{initials(user.nickname || user.username)}
							</span>
							<span className="mention-suggestion-copy">
								<span>{userLabel(user, user.id)}</span>
								<small>@{user.username}</small>
							</span>
						</button>
					))}
				</div>
			) : null}
			<input
				accept={fileAccept}
				multiple
				ref={fileInputRef}
				type="file"
				hidden
				onChange={(event) => {
					setFiles((current) => [
						...current,
						...Array.from(event.target.files ?? []),
					]);
					setFileAccept(undefined);
					event.currentTarget.value = "";
				}}
			/>
			<div className="composer-actions">
				<button
					aria-label="Attach files"
					className="composer-action-button"
					disabled={disabled || Boolean(editTarget)}
					type="button"
					onClick={() => openFilePicker()}
				>
					<Paperclip size={16} />
				</button>
				<EmojiPickerPopover
					label="Insert emoji"
					open={emojiPickerOpen}
					onSelectEmoji={(emoji) => insertEmoji(emoji)}
					onOpenChange={setEmojiPickerOpen}
				>
					<button
						aria-label="Insert emoji"
						className="composer-action-button"
						disabled={disabled}
						type="button"
					>
						<SmilePlus size={16} />
					</button>
				</EmojiPickerPopover>
				{giphyApiKey ? (
					<GiphyPickerPopover
						apiKey={giphyApiKey}
						open={giphyPickerOpen}
						onSelectGif={insertGif}
						onOpenChange={setGiphyPickerOpen}
					>
						<button
							aria-label="Insert GIF"
							className="composer-action-button"
							disabled={disabled}
							type="button"
						>
							<Sticker size={16} />
						</button>
					</GiphyPickerPopover>
				) : null}
				<button
					aria-label="Send message"
					className="send-button"
					disabled={!canSend}
					type="button"
					onClick={submit}
				>
					<Send size={18} />
				</button>
			</div>
		</div>
	);
});
