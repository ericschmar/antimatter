import DocViewer, { DocViewerRenderers } from "@iamjariwala/react-doc-viewer";
import type { IDocument } from "@iamjariwala/react-doc-viewer";
import "@iamjariwala/react-doc-viewer/dist/index.css";
import { Download, ExternalLink, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MattermostApiClient } from "../mattermostApi";
import type { MattermostFileInfo } from "../types";

type PreviewState =
	| { status: "idle" | "loading" }
	| { status: "ready"; document: IDocument; objectUrl: string }
	| { status: "error"; message: string };

export const attachmentPreviewDocViewerConfig = {
	dragDrop: { enableDragDrop: false },
	fullscreen: { enableFullscreen: true },
	header: { disableHeader: true, disableFileName: true },
	keyboard: { enableKeyboardShortcuts: true },
	loadingProgress: { enableProgressBar: true },
	password: { enablePasswordPrompt: true },
	pdfVerticalScrollByDefault: true,
	search: { enableSearch: true },
	themeMode: "dark" as const,
	thumbnail: { enableThumbnails: true },
};

export function AttachmentPreviewDialog({
	api,
	file,
	onClose,
	onOpenExternal,
}: {
	api: MattermostApiClient | null;
	file: MattermostFileInfo | null;
	onClose: () => void;
	onOpenExternal: (file: MattermostFileInfo) => Promise<void>;
}) {
	const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
	const fileName = file?.name ?? file?.id ?? "Attachment";
	const fileType = useMemo(() => fileTypeForAttachment(file), [file]);

	useEffect(() => {
		if (!api || !file) {
			setPreview({ status: "idle" });
			return;
		}

		let cancelled = false;
		let objectUrl: string | null = null;
		setPreview({ status: "loading" });

		void api
			.getFileDataUrl(`/files/${encodeURIComponent(file.id)}`)
			.then((dataUrl) => {
				if (cancelled) return;
				const blob = dataUrlToBlob(dataUrl, file.mime_type);
				objectUrl = URL.createObjectURL(blob);
				setPreview({
					status: "ready",
					document: {
						uri: objectUrl,
						fileName,
						fileType,
					},
					objectUrl,
				});
			})
			.catch((error) => {
				if (cancelled) return;
				setPreview({
					status: "error",
					message:
						error instanceof Error
							? error.message
							: "Could not load attachment preview.",
				});
			});

		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [api, file, fileName, fileType]);

	if (!file) return null;

	return (
		<div className="modal-backdrop attachment-preview-backdrop" onMouseDown={onClose}>
			<section
				aria-label={`Preview ${fileName}`}
				className="attachment-preview-panel"
				role="dialog"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="attachment-preview-header">
					<div>
						<p className="eyebrow">Attachment</p>
						<h2>{fileName}</h2>
					</div>
					<div className="attachment-preview-actions">
						<button
							aria-label="Open with default application"
							title="Open with default application"
							type="button"
							onClick={() => void onOpenExternal(file)}
						>
							<ExternalLink size={16} />
						</button>
						{preview.status === "ready" ? (
							<a
								aria-label="Download attachment"
								download={fileName}
								href={preview.objectUrl}
								title="Download attachment"
							>
								<Download size={16} />
							</a>
						) : null}
						<button aria-label="Close preview" title="Close preview" type="button" onClick={onClose}>
							<X size={16} />
						</button>
					</div>
				</header>
				<div className="attachment-preview-body">
					{preview.status === "loading" || preview.status === "idle" ? (
						<div className="attachment-preview-state">Loading preview...</div>
					) : null}
					{preview.status === "error" ? (
						<div className="attachment-preview-state">
							<p>{preview.message}</p>
							<button className="primary-action" type="button" onClick={() => void onOpenExternal(file)}>
								Open externally
							</button>
						</div>
					) : null}
					{preview.status === "ready" ? (
						<DocViewer
							config={attachmentPreviewDocViewerConfig}
							documents={[preview.document]}
							pluginRenderers={DocViewerRenderers}
						/>
					) : null}
				</div>
			</section>
		</div>
	);
}

function fileTypeForAttachment(file: MattermostFileInfo | null) {
	if (!file) return undefined;
	if (file.mime_type) return file.mime_type;
	if (file.extension) return file.extension;
	return file.name?.split(".").pop();
}

function dataUrlToBlob(dataUrl: string, fallbackMimeType?: string) {
	const [header, payload = ""] = dataUrl.split(",");
	const mimeType = /data:([^;]+)/.exec(header)?.[1] ?? fallbackMimeType ?? "application/octet-stream";
	const binary = atob(payload);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return new Blob([bytes], { type: mimeType });
}
