import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	attachmentPreviewDocViewerConfig,
	isMarkdownAttachment,
} from "./AttachmentPreviewDialog";

describe("AttachmentPreviewDialog", () => {
	test("disables react-doc-viewer's own header", () => {
		expect(attachmentPreviewDocViewerConfig.header?.disableHeader).toBe(true);
	});

	test("overrides react-doc-viewer's image backgrounds", () => {
		const css = readFileSync(join(import.meta.dir, "../index.css"), "utf8");

		expect(css).toContain(".attachment-preview-body .rdv-image-container");
		expect(css).toContain("background: var(--app-bg)");
		expect(css).toContain(".attachment-preview-body .rdv-png-checkerboard");
		expect(css).toContain("background-image: none");
	});

	test("recognizes markdown attachments by mime type and extension", () => {
		expect(isMarkdownAttachment({ id: "1", mime_type: "text/markdown" })).toBe(
			true,
		);
		expect(
			isMarkdownAttachment({ id: "1", mime_type: "text/x-markdown" }),
		).toBe(true);
		expect(
			isMarkdownAttachment({
				id: "1",
				mime_type: "application/octet-stream",
				extension: "md",
			}),
		).toBe(true);
		expect(isMarkdownAttachment({ id: "1", name: "notes.markdown" })).toBe(
			true,
		);
		expect(
			isMarkdownAttachment({ id: "1", mime_type: "text/plain", name: "a.txt" }),
		).toBe(false);
		expect(isMarkdownAttachment(null)).toBe(false);
	});

	test("renders markdown attachments with the app markdown renderer", () => {
		const body = readFileSync(
			join(import.meta.dir, "AttachmentPreviewDialog.tsx"),
			"utf8",
		);

		expect(body).toContain("isMarkdownAttachment(file)");
		expect(body).toContain("<MarkdownMessage");
		expect(body).toContain('className="attachment-preview-markdown"');
	});

	test("styles the markdown preview pane", () => {
		const css = readFileSync(join(import.meta.dir, "../index.css"), "utf8");

		expect(css).toContain(".attachment-preview-markdown");
	});
});
