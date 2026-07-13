import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attachmentPreviewDocViewerConfig } from "./AttachmentPreviewDialog";

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
});
