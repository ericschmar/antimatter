import { FileText } from "lucide-react";
import { type CSSProperties, memo, useState } from "react";
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
	const frameStyle = imageFrameStyle(file, loadInfo);
	return (
		<button
			aria-label={`Open ${file.name ?? "attached image"}`}
			className="inline-image-link"
			disabled={opening}
			type="button"
			onClick={onOpen}
		>
			{src && loadInfo.state === "loaded" ? (
				<span className="inline-image-frame loaded" style={frameStyle}>
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
			) : frameStyle ? (
				<span className="inline-image-frame loading" style={frameStyle}>
					{opening ? "Opening..." : (file.name ?? "Loading image...")}
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

function imageFrameStyle(
	file: MattermostFileInfo,
	loadInfo: ReturnType<typeof useImageLoadInfo>,
): CSSProperties | undefined {
	const width = positiveDimension(file.width);
	const height = positiveDimension(file.height);
	const frameWidth =
		width ?? (loadInfo.state === "loaded" ? loadInfo.width : undefined);
	if (width && height) {
		return { aspectRatio: width / height, width: Math.min(width, 520) };
	}
	if (loadInfo.state === "loaded") {
		return {
			aspectRatio: loadInfo.width / loadInfo.height,
			width: Math.min(loadInfo.width, 520),
		};
	}
	if (frameWidth) return { width: Math.min(frameWidth, 520) };
	return undefined;
}

function positiveDimension(value: number | undefined) {
	return Number.isFinite(value) && value && value > 0 ? value : undefined;
}

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
