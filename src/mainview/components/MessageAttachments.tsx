import { FileText } from "lucide-react";
import { memo, useState } from "react";
import type { MattermostFileInfo } from "../types";
import { useImageLoadInfo, useResolvedImageSrc } from "./MarkdownMessage";

export const MessageAttachments = memo(function MessageAttachments({
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
});

const InlineImageAttachment = memo(function InlineImageAttachment({
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
	const src = useResolvedImageSrc(
		`/files/${encodeURIComponent(file.id)}`,
		resolveImageSrc,
	);
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
					<img
						alt={file.name ?? "Attached image"}
						className="inline-image"
						loading="lazy"
						src={src}
					/>
				</span>
			) : src && loadInfo.state === "failed" ? (
				<span className="inline-image-loading">
					{opening ? "Opening..." : (file.name ?? "Open image")}
				</span>
			) : (
				<span className="inline-image-loading">
					{opening ? "Opening..." : (file.name ?? "Loading image...")}
				</span>
			)}
		</button>
	);
});

const FileAttachment = memo(function FileAttachment({
	file,
	opening,
	onOpen,
}: {
	file: MattermostFileInfo;
	opening: boolean;
	onOpen: () => void;
}) {
	return (
		<button
			className="file-attachment"
			disabled={opening}
			type="button"
			onClick={onOpen}
		>
			<FileText size={16} />
			<span>{opening ? "Opening..." : (file.name ?? file.id)}</span>
		</button>
	);
});

function isImageFile(file: MattermostFileInfo) {
	const mimeType = file.mime_type?.toLowerCase() ?? "";
	const extension =
		file.extension?.toLowerCase() ||
		file.name?.split(".").pop()?.toLowerCase() ||
		"";
	return (
		mimeType.startsWith("image/") ||
		["gif", "jpg", "jpeg", "png", "webp", "avif"].includes(extension) ||
		file.has_preview_image === true
	);
}
