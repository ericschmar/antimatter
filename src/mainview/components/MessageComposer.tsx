import {
	BlockTypeSelect,
	BoldItalicUnderlineToggles,
	ChangeCodeMirrorLanguage,
	CodeToggle,
	codeBlockPlugin,
	codeMirrorPlugin,
	ConditionalContents,
	DiffSourceToggleWrapper,
	diffSourcePlugin,
	headingsPlugin,
	imagePlugin,
	InsertCodeBlock,
	InsertTable,
	InsertThematicBreak,
	linkDialogPlugin,
	linkPlugin,
	listsPlugin,
	ListsToggle,
	markdownShortcutPlugin,
	MDXEditor,
	type MDXEditorMethods,
	quotePlugin,
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
	Table2,
	Type,
	Underline,
	Undo2,
	X,
} from "lucide-react";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { KeyboardEvent } from "react";
import type { MattermostPost, MattermostUser } from "../types";
import { userLabel } from "../utils/format";
import { MarkdownMessage } from "./MarkdownMessage";
import "./MessageComposer.css";

const TOOLBAR_ICON_SIZE = 14;
const TYPING_UPDATE_INTERVAL_MS = 4000;

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

export type MessageComposerHandle = {
	focus: () => void;
};

type MessageComposerProps = {
	disabled: boolean;
	replyTarget: MattermostPost | null;
	editTarget: MattermostPost | null;
	users: Record<string, MattermostUser>;
	userColors: Record<string, string>;
	currentUserId: string;
	onCancelEdit: () => void;
	onCancelReply: () => void;
	onEdit: (post: MattermostPost, message: string) => Promise<void>;
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
		replyTarget,
		users,
		userColors,
		currentUserId,
		onCancelEdit,
		onCancelReply,
		onEdit,
		onSend,
		onTyping,
	},
	ref,
) {
	const [message, setMessage] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const editorRef = useRef<MDXEditorMethods>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const lastTypingUpdateRef = useRef(0);
	const canSend = !disabled && (message.trim().length > 0 || files.length > 0);
	const plugins = useMemo(
		() => [
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
												className="composer-toolbar-attach"
												disabled={disabled || Boolean(editTarget)}
												type="button"
												onClick={() => fileInputRef.current?.click()}
											>
												<Paperclip size={TOOLBAR_ICON_SIZE} />
											</button>
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
		[disabled, editTarget],
	);

	function submit() {
		const trimmed = message.trim();
		if (!trimmed && files.length === 0) return;
		if (editTarget) {
			void onEdit(editTarget, trimmed);
			lastTypingUpdateRef.current = 0;
			setMessage("");
			editorRef.current?.setMarkdown("");
			return;
		}
		const rootId = replyTarget?.root_id || replyTarget?.id;
		const filesToSend = files;
		lastTypingUpdateRef.current = 0;
		setMessage("");
		setFiles([]);
		editorRef.current?.setMarkdown("");
		void onSend(trimmed, rootId, filesToSend);
	}

	function handleMessageChange(nextMessage: string) {
		setMessage(nextMessage);
		if (disabled || editTarget || nextMessage.trim().length === 0) return;

		const now = Date.now();
		if (now - lastTypingUpdateRef.current < TYPING_UPDATE_INTERVAL_MS) return;

		lastTypingUpdateRef.current = now;
		void onTyping(replyTarget?.root_id || replyTarget?.id);
	}

	function handleComposerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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

	useImperativeHandle(ref, () => ({ focus: focusEditor }), [disabled]);

	useEffect(() => {
		if (disabled) return;
		const frame = requestAnimationFrame(focusEditor);
		return () => cancelAnimationFrame(frame);
	}, [disabled]);

	useEffect(() => {
		if (!editTarget) return;
		setFiles([]);
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
				className={disabled ? "composer-editor disabled" : "composer-editor"}
				onClick={(event) => {
					const target = event.target as HTMLElement;
					if (
						target.closest("[contenteditable='true'], button, [role='toolbar']")
					)
						return;
					focusEditor();
				}}
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
			<input
				multiple
				ref={fileInputRef}
				type="file"
				hidden
				onChange={(event) => {
					setFiles((current) => [
						...current,
						...Array.from(event.target.files ?? []),
					]);
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
