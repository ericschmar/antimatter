import {
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	ChangeCodeMirrorLanguage,
	CodeToggle,
	codeBlockPlugin,
	codeMirrorPlugin,
	ConditionalContents,
	createRootEditorSubscription$,
	DiffSourceToggleWrapper,
	diffSourcePlugin,
	headingsPlugin,
	imagePlugin,
	InsertCodeBlock,
	InsertTable,
	InsertThematicBreak,
	insertCodeMirror$,
	linkDialogPlugin,
	linkPlugin,
	listsPlugin,
	ListsToggle,
	markdownShortcutPlugin,
	MDXEditor,
	type MDXEditorMethods,
	quotePlugin,
	realmPlugin,
	Separator,
	tablePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
	UndoRedo,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import {
	Bold,
	CheckSquare,
	Code2,
	FileCode2,
	GitCompare,
	Image,
	Italic,
	Link,
	List,
	ListOrdered,
	Minus,
	Paperclip,
	Redo2,
	Send,
	SmilePlus,
	Sticker,
	Table2,
	Type,
	Underline,
	Undo2,
	X,
} from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { COMMAND_PRIORITY_HIGH, PASTE_COMMAND, $getRoot } from "lexical";
import type { KeyboardEvent } from "react";
import type { LexicalEditor } from "lexical";
import type { MattermostPost, MattermostUser } from "../types";
import { initials, userLabel } from "../utils/format";
import { normalizeOutgoingMessage } from "../utils/outgoingMessage";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import { GiphyPickerPopover } from "./GiphyPickerPopover";
import type { GiphyGif } from "./GiphyPickerPopover";
import { MarkdownMessage } from "./MarkdownMessage";
import { buildMentionInsertion, matchMentionQuery } from "./mentions";
import "./MessageComposer.css";

const TOOLBAR_ICON_SIZE = 14;
const TYPING_UPDATE_INTERVAL_MS = 4000;

function isLikelyCodePaste(text: string) {
	const normalizedText = text.replace(/\r\n?/g, "\n");
	const lines = normalizedText.split("\n");
	const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
	if (nonEmptyLines.length < 2) return false;

	return (
		nonEmptyLines.some((line) => /^\s{2,}|\t/.test(line)) ||
		/[{}()[\];=<>]/.test(normalizedText) ||
		/\b(class|const|def|enum|export|function|if|import|interface|let|return|type|var)\b/.test(
			normalizedText,
		)
	);
}

const preserveCodePastePlugin = realmPlugin({
	init(realm) {
		realm.pub(createRootEditorSubscription$, (editor) =>
			editor.registerCommand(
				PASTE_COMMAND,
				(event) => {
					if (!(event instanceof ClipboardEvent)) return false;
					const text = event.clipboardData?.getData("text/plain");
					if (!text || !isLikelyCodePaste(text)) return false;

					event.preventDefault();
					realm.pub(insertCodeMirror$, {
						code: text.replace(/\r\n?/g, "\n"),
						language: "txt",
					});
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		);
	},
});

function captureRootEditorPlugin(editorRef: React.RefObject<LexicalEditor | null>) {
	return realmPlugin({
		init(realm) {
			realm.pub(createRootEditorSubscription$, (editor) => {
				editorRef.current = editor;
				return () => {
					if (editorRef.current === editor) {
						editorRef.current = null;
					}
				};
			});
		},
	});
}

function composerToolbarIcon(name: string) {
	const iconProps = {
		"aria-hidden": true,
		className: "composer-toolbar-icon",
		size: TOOLBAR_ICON_SIZE,
		strokeWidth: 2,
	};

	switch (name) {
		case "undo":
			return <Undo2 {...iconProps} />;
		case "redo":
			return <Redo2 {...iconProps} />;
		case "format_bold":
			return <Bold {...iconProps} />;
		case "format_italic":
			return <Italic {...iconProps} />;
		case "format_underlined":
			return <Underline {...iconProps} />;
		case "frame_source":
			return <Code2 {...iconProps} />;
		case "code":
			return <Code2 {...iconProps} />;
		case "format_list_bulleted":
			return <List {...iconProps} />;
		case "format_list_numbered":
			return <ListOrdered {...iconProps} />;
		case "format_list_checked":
			return <CheckSquare {...iconProps} />;
		case "link":
			return <Link {...iconProps} />;
		case "add_photo":
			return <Image {...iconProps} />;
		case "table":
			return <Table2 {...iconProps} />;
		case "horizontal_rule":
			return <Minus {...iconProps} />;
		case "rich_text":
			return <Type {...iconProps} />;
		case "difference":
			return <GitCompare {...iconProps} />;
		case "markdown":
			return <FileCode2 {...iconProps} />;
		default:
			return <span aria-hidden className="composer-toolbar-icon" />;
	}
}

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

export type MessageComposerHandle = {
	attachFiles: () => void;
	attachImages: () => void;
	focus: () => void;
	openEmojiPicker: () => void;
};

type MessageComposerProps = {
	disabled: boolean;
	replyTarget: MattermostPost | null;
	editTarget: MattermostPost | null;
	giphyApiKey?: string;
	mentionUsers: MattermostUser[];
	users: Record<string, MattermostUser>;
	userColors: Record<string, string>;
	currentUserId: string;
	composerHeight: number;
	maxComposerHeight: number;
	onCancelEdit: () => void;
	onCancelReply: () => void;
	onEdit: (post: MattermostPost, message: string) => Promise<void>;
	onRequestComposerHeight: (height: number) => void;
	onSend: (message: string, rootId?: string, files?: File[]) => Promise<void>;
	onTyping: (rootId?: string) => Promise<void>;
};

export const MessageComposer = forwardRef<
	MessageComposerHandle,
	MessageComposerProps
>(function MessageComposer(
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
	const editorRef = useRef<MDXEditorMethods>(null);
	const lexicalEditorRef = useRef<LexicalEditor | null>(null);
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

	const handleMessageChange = useCallback(
		(nextMessage: string) => {
			messageRef.current = nextMessage;
			setMessage(nextMessage);
			const lineCount = nextMessage.split(/\r\n|\r|\n/).length;
			const shouldExpandForLargePaste =
				composerHeight < maxComposerHeight &&
				(lineCount > 6 || nextMessage.length > 800);
			if (shouldExpandForLargePaste) {
				onRequestComposerHeight(maxComposerHeight);
			}
			requestAnimationFrame(() => {
				const editor = composerEditorRef.current;
				const input = editor?.querySelector<HTMLElement>(".composer-input");
				if (!input || composerHeight >= maxComposerHeight) return;
				if (input.scrollHeight > input.clientHeight + 2) {
					onRequestComposerHeight(maxComposerHeight);
				}
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
			maxComposerHeight,
			onRequestComposerHeight,
			onTyping,
			replyTarget?.id,
			replyTarget?.root_id,
		],
	);

	const insertEmoji = useCallback(
		(emoji: string) => {
			if (disabled || !emoji) return;
			editorRef.current?.focus(
				() => {
					editorRef.current?.insertMarkdown(emoji);
					handleMessageChange(
						editorRef.current?.getMarkdown() ?? messageRef.current + emoji,
					);
				},
				{ defaultSelection: "rootEnd", preventScroll: true },
			);
		},
		[disabled, handleMessageChange],
	);

	const insertGif = useCallback(
		(gif: GiphyGif) => {
			const gifMarkdown = giphyGifMarkdown(gif);
			if (disabled || !gifMarkdown) return;
			const markdownToInsert =
				messageRef.current.trim().length > 0 ? `\n${gifMarkdown}\n` : gifMarkdown;
			editorRef.current?.focus(
				() => {
					editorRef.current?.insertMarkdown(markdownToInsert);
					handleMessageChange(
						editorRef.current?.getMarkdown() ??
							`${messageRef.current}${markdownToInsert}`,
					);
				},
				{ defaultSelection: "rootEnd", preventScroll: true },
			);
		},
		[disabled, handleMessageChange],
	);

	const insertMention = useCallback(
		(user: MattermostUser) => {
			if (!mentionMatch) return;
			const insertion = buildMentionInsertion(
				message,
				mentionMatch,
				user.username,
			);
			messageRef.current = insertion.message;
			setMessage(insertion.message);
			editorRef.current?.setMarkdown(insertion.message);
			lexicalEditorRef.current?.update(() => {
				$getRoot().selectEnd();
			});
			lexicalEditorRef.current?.focus(undefined, {
				defaultSelection: "rootEnd",
			});
		},
		[mentionMatch, message],
	);

	const openFilePicker = useCallback(
		(accept?: string) => {
			if (disabled || editTarget) return;
			setFileAccept(accept);
			requestAnimationFrame(() => fileInputRef.current?.click());
		},
		[disabled, editTarget],
	);

	const plugins = useMemo(
		() => [
			preserveCodePastePlugin(),
			captureRootEditorPlugin(lexicalEditorRef)(),
			toolbarPlugin({
				toolbarClassName: "composer-toolbar",
				toolbarContents: () => (
					<DiffSourceToggleWrapper options={["rich-text", "source"]}>
						<ConditionalContents
							options={[
								{
									when: (editor) => editor?.editorType === "codeblock",
									contents: () => <ChangeCodeMirrorLanguage />,
								},
								{
									fallback: () => (
										<>
											<UndoRedo />
											<Separator />
											<BoldItalicUnderlineToggles />
											<CodeToggle />
											<Separator />
											<ListsToggle />
											<Separator />
											<BlockTypeSelect />
											<Separator />
											<button
												aria-label="Attach files"
												className="composer-toolbar-button"
												disabled={disabled || Boolean(editTarget)}
												type="button"
												onClick={() => openFilePicker()}
											>
												<Paperclip size={TOOLBAR_ICON_SIZE} />
											</button>
											<EmojiPickerPopover
												label="Insert emoji"
												open={emojiPickerOpen}
												onSelectEmoji={(emoji) => insertEmoji(emoji)}
												onOpenChange={setEmojiPickerOpen}
											>
												<button
													aria-label="Insert emoji"
													className="composer-toolbar-button"
													disabled={disabled}
													type="button"
												>
													<SmilePlus size={TOOLBAR_ICON_SIZE} />
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
														className="composer-toolbar-button"
														disabled={disabled}
														type="button"
													>
														<Sticker size={TOOLBAR_ICON_SIZE} />
													</button>
												</GiphyPickerPopover>
											) : null}
											<Separator />
											<InsertTable />
											<InsertThematicBreak />
											<Separator />
											<InsertCodeBlock />
										</>
									),
								},
							]}
						/>
					</DiffSourceToggleWrapper>
				),
			}),
			headingsPlugin(),
			listsPlugin(),
			quotePlugin(),
			thematicBreakPlugin(),
			linkPlugin(),
			linkDialogPlugin(),
			imagePlugin(),
			tablePlugin(),
			codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
			codeMirrorPlugin(),
			diffSourcePlugin({ viewMode: "rich-text" }),
			markdownShortcutPlugin(),
		],
		[
			disabled,
			editTarget,
			emojiPickerOpen,
			giphyApiKey,
			giphyPickerOpen,
			insertEmoji,
			insertGif,
			openFilePicker,
		],
	);

	async function submit() {
		const normalizedMessage = normalizeOutgoingMessage(message.trim());
		if (sending || (!normalizedMessage && files.length === 0)) return;
		if (editTarget) {
			void onEdit(editTarget, normalizedMessage);
			lastTypingUpdateRef.current = 0;
			messageRef.current = "";
			setMessage("");
			editorRef.current?.setMarkdown("");
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
			editorRef.current?.setMarkdown("");
			onCancelReply();
		} catch {
			// MainViewApp surfaces send errors; keep the draft intact for retry.
		} finally {
			setSending(false);
		}
	}

	function handleComposerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (showMentionSuggestions) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActiveMentionIndex((current) =>
					(current + 1) % mentionSuggestions.length,
				);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setActiveMentionIndex(
					(current) =>
						(current - 1 + mentionSuggestions.length) %
						mentionSuggestions.length,
				);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				insertMention(mentionSuggestions[activeMentionIndex] ?? mentionSuggestions[0]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setActiveMentionIndex(-1);
				return;
			}
		}
		if (
			event.key !== "Enter" ||
			event.shiftKey ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey
		) {
			return;
		}
		event.preventDefault();
		submit();
	}

	function focusEditor() {
		if (disabled) return;
		editorRef.current?.focus(undefined, {
			defaultSelection: "rootEnd",
			preventScroll: true,
		});
	}

	const handleDragEnter = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
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
		(event: React.DragEvent<HTMLDivElement>) => {
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
		(event: React.DragEvent<HTMLDivElement>) => {
			if (disabled || editTarget) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = "copy";
		},
		[disabled, editTarget],
	);

	const handleDrop = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
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
		[disabled, openFilePicker],
	);

	useEffect(() => {
		if (disabled) return;
		const frame = requestAnimationFrame(focusEditor);
		return () => cancelAnimationFrame(frame);
	}, [disabled]);

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
		editorRef.current?.setMarkdown(editTarget.message);
		requestAnimationFrame(focusEditor);
	}, [editTarget]);

	const replyAuthor = replyTarget ? users[replyTarget.user_id] : undefined;
	const replyLabel = replyTarget
		? replyTarget.user_id === currentUserId
			? "You"
			: userLabel(replyAuthor, replyTarget.user_id)
		: "";

	return (
		<div className="composer" onKeyDown={handleComposerKeyDown}>
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
					if (
						target.closest("[contenteditable='true'], button, [role='toolbar']")
					)
						return;
					focusEditor();
				}}
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				<MDXEditor
					className="composer-mdxeditor"
					contentEditableClassName="composer-input"
					iconComponentFor={composerToolbarIcon}
					markdown={message}
					plugins={plugins}
					ref={editorRef}
					readOnly={disabled}
					onChange={handleMessageChange}
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
								editorRef.current?.setMarkdown("");
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
