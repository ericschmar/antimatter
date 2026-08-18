---
name: antimatter-attachment-preview-file-types
description: Add custom rendering for attachment types (e.g. markdown) in Antimatter's AttachmentPreviewDialog when @iamjariwala/react-doc-viewer's built-in renderers don't match. Covers its fileType-selection internals, the PreviewState bypass pattern, data-URL decoding, CSS and test conventions.
---

# Attachment preview: custom file types in AttachmentPreviewDialog

Use when a Mattermost attachment renders as react-doc-viewer's "No renderer for
file type" message and should render with an app component instead
(implemented for markdown in antimatter-9a2).

## Why react-doc-viewer misses types

DocViewer picks a renderer from `pluginRenderers` by EXACT membership
(`renderer.fileTypes.indexOf(currentDocument.fileType) >= 0`), then sorts matches
by descending `weight`; no match → i18n `noRendererMessage`. The `fileType` you
pass on the `IDocument` must literally equal one of the renderer's strings — a
Mattermost-reported mime_type that differs silently falls through. The bundled
`MarkdownRenderer` (fileTypes `["md","text/markdown","text/x-markdown"]`) renders
DOMPurify-sanitized HTML via `dangerouslySetInnerHTML`, not the app's
react-markdown/remark-gfm pipeline — bypass it and use the app renderer
(`MarkdownMessage`).

## Bypass pattern (src/mainview/components/AttachmentPreviewDialog.tsx)

1. Export a predicate, e.g. `isMarkdownAttachment(file: MattermostFileInfo | null)`:
   check `file.mime_type` against a Set of mime types, then fall back to
   `file.extension ?? file.name?.split(".").pop()?.toLowerCase()` against an
   extension Set (`md markdown mdown mkd`).
2. Add a `PreviewState` variant like
   `{ status: "markdown-ready"; markdown: string; objectUrl: string }` — include
   `objectUrl`, or the header's download button (gated on status) loses its type.
3. In the load effect, after `dataUrlToBlob` / `URL.createObjectURL`, branch on the
   predicate, `setPreview` with the decoded text, and `return` before the DocViewer
   `ready` state.
4. Render a sibling JSX branch next to `<DocViewer>`:
   `<div className="attachment-preview-markdown"><MarkdownMessage markdown={...} /></div>`.
5. Gate the download `<a>` with
   `preview.status === "ready" || preview.status === "markdown-ready"`.

## Data URL decoding

`api.getFileDataUrl()` (mattermostApi.ts) returns a base64 data URL
(FileReader.readAsDataURL under the hood). Decode with the file-local helpers:
split on the first comma, `atob` → `Uint8Array` (`dataUrlToBytes`), then
`TextDecoder` for text. `dataUrlToBlob` reuses `dataUrlToBytes`.

## CSS and tests

- Styles go in `src/mainview/index.css` next to the other `.attachment-preview-*`
  rules. Pane: `height: 100%; min-height: 0; overflow-y: auto`; typography on
  `.attachment-preview-markdown .markdown-message`.
- Tests in `AttachmentPreviewDialog.test.ts`: unit-test the predicate with
  `MattermostFileInfo` fixtures; source-slice assertions (`readFileSync` +
  `expect(body).toContain(...)`) for the component wiring and CSS selectors.
- Run `bunx @biomejs/biome check --write` on touched files BEFORE copying snippets
  into source-slice expectations (Biome reflows code).

## Verification

```bash
bun test src/mainview/components/AttachmentPreviewDialog.test.ts && bun run typecheck
```
