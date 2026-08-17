---
description: Implement or debug Antimatter timeline image space reservation for Mattermost attachments and markdown images.
---

# Antimatter timeline image space reservation

Use this when working on timeline scroll stability issues caused by late image layout shifts.

## Workflow

- Start from `docs/design/2026-08-14-timeline-scroll-professionalism-design.md` section 5b.
- Add a focused server-render regression in `src/mainview/components/mui-headless-timeline/MuiMessageTimeline.test.tsx` that renders an image attachment with `width` and `height` in `metadata.files` and expects an `inline-image-frame` with the metadata-derived aspect ratio before image load resolves.
- Extend `MattermostFileInfo` and `MattermostUploadedFile` in `src/mainview/types.ts` with optional `width?: number` and `height?: number`.
- In `src/mainview/components/MessageAttachments.tsx`, compute frame style from valid positive metadata dimensions before falling back to `useImageLoadInfo`; keep the failed-image branch ahead of the metadata placeholder branch so a failed resolved image still shows the existing fallback text.
- Add dimensions to `tests/e2e/harness/fixture.ts` image fixtures from `IMAGE_DIMENSIONS`, otherwise the e2e harness will not exercise the metadata path.
- For markdown images, add a focused test in `src/mainview/components/MessageMarkdown.test.ts`. Because the file is `.ts`, use `createElement` instead of JSX. Use a normal `/files/image.png` URL; `mattermost://...` may be stripped by the markdown parser during SSR and never reach the image renderer.
- Reserve bounded unknown markdown image space with `height: 240` in both `MarkdownMessage.tsx` and the `@uiw` path in `MessageMarkdown.tsx`.

## Verification

- `bun test src/mainview/components/MessageMarkdown.test.ts src/mainview/components/mui-headless-timeline/MuiMessageTimeline.test.tsx`
- `bun run typecheck`
- `bun run test:e2e`
- `bunx @biomejs/biome check <touched files>`
- `bun test`
- `bun run build`

`bunx @biomejs/biome check .` may fail on unrelated pre-existing repo issues such as `src/mainview/state/chatWorkspace.ts`, `src/mainview/utils/perfTrace.ts`, or generated `test-results/.last-run.json`; report that separately rather than fixing unrelated files during 5b.