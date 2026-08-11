---
name: antimatter-mui-timeline-render-perf
description: Diagnose and fix rendering jank in Antimatter's MUI X Chat headless timeline. Covers perfTrace instrumentation, the renderer data flow, and the memoization levers (markdown value-comparator memo, posts-array-reference memoization in buildTimelineRows, per-message ChatMessage object cache in buildMuiTimelineMessages). Use when the chat timeline feels janky, over-renders on incoming messages/avatars/presence, or when measuring render perf before/after a timeline change.
---

# MUI timeline rendering performance

## When to use
- The MUI headless chat timeline (`src/mainview/components/mui-headless-timeline/`) feels janky, stutters on scroll, or over-renders.
- A change touches the timeline, the posts/users/avatars/presence data flow, or markdown rendering, and you need a before/after measurement.
- You want to add or extend a memoization cache for message rendering.

## The renderer data flow (read this first)
The MUI timeline is the **canonical** one (branch `replace-timeline-mui-chat`); legacy `components/MessageTimeline.tsx` is being retired — don't invest in it.

Renderer data is **prop-drilled from `useState`, not in a store**:
- `NormalizedState` (flat `posts` Record, `postOrder`, `users`, `channels`) — `useState` in `app/MainViewApp.tsx` (~line 216).
- `userImages`, `userStatuses`, `userColors`, `settings` — `useState` in `features/users/useUserPresence.ts`.
- `typingUsers` is the exception: already in Valtio `state/uiStore.ts`.
- `MuiMessageTimeline` mounts at **two sites**: `app/ChatShell.tsx` (~520) and `components/ChatWorkspace.tsx` (~208), both fed from `MainViewApp`.

Amplifier: `MuiTimelineProvider` (`MuiTimelineContext.tsx`) builds a **fresh value object every render**, so every `useMuiTimelineContext()` consumer re-renders regardless of `React.memo`. This is the dominant re-render-scope cause.

## How to measure: perfTrace
`src/mainview/utils/perfTrace.ts` (off by default, stays in-tree through the migration):
- Toggle: `localStorage.setItem("mm-clone:perf", "1")` then reload; remove the key to disable.
- `traceSync(label, fn)` times synchronous work; wraps `buildMuiTimelineMessages`.
- `markRender(name)` buffers per-component render counts, flushed ~every 1.5s to `console.debug`.
- Wired into `MarkdownRenderer`, `MattermostTextPart`, `MuiMessageItem`.
- The `enabled` flag is cached once at module import, so tests must reset with `__setPerfEnabled(false)` in `beforeAll` + `__resetPerfCache()` in `afterEach`.

Key numbers: `MarkdownRenderer`/`MattermostTextPart`/`MuiMessageItem` commits per incoming message, and `buildMuiTimelineMessages` call count/time. If commits ≈ visible rows per new message, re-render scope is confirmed.

## The three memoization levers (all already applied)
1. **Markdown value-comparator memo** — `MarkdownRenderer` is wrapped in `React.memo` with an exported `markdownPropsEqual` comparator (`components/MessageMarkdown.tsx`). Markdown parsing is the dominant per-render cost; comparing by value (markdown, currentUsername, useNewComposer, resolveImageSrc identity) lets React bail out. Measured: ~1080 fresh parses at startup → 0 on re-render.
2. **Posts-array-reference memoization in `buildTimelineRows`** (`utils/timeline.ts`) — returns the same `rows` (and reply arrays) when the same `posts` array reference is passed. Avatars/presence stream in without reallocating the posts array, so identity stays stable. Has `__resetTimelineRowsCache` test hook.
3. **Per-message object cache in `buildMuiTimelineMessages`** (`mui-headless-timeline/muiChatModels.ts`) — reuses a `ChatMessage` object keyed by post id as long as all inputs are referentially equal (post; replies compared by content so a post burst doesn't defeat it; author user; avatar; status; color; channelId; currentUserId). Channel change clears it; capped at 1000. This is what makes `MuiMessageItem`'s `memo` bail. Has `__resetMuiMessageCache` test hook.

## TDD pattern for these caches
Write a test asserting object reference equality (`expect(second[0]).toBe(first[0])`) and selective invalidation (`expect(changed).not.toBe(first)`; `expect(unchanged).toBe(first)`) BEFORE implementing, using the `__reset*` hooks in `beforeEach`. Match the existing tests in `utils/timeline.test.ts` and `mui-headless-timeline/muiChatModels.test.ts`.

## Known remaining issues (deferred)
- **"Opens above the bottom" scroll defect** — channel opens a few messages above the true bottom; the double `scrollToBottom` + `requestAnimationFrame` + `setLoadMoreReadyChannelId` in `MuiMessageTimeline.tsx` (~lines 171-191) is the suspect. Not yet fixed.
- **Stabilizing `renderItem` identity** — deliberately skipped; the per-message cache (lever 3) lets `MuiMessageItem` memo bail regardless. Revisit only if re-measurement shows `MessageList` bookkeeping cost.
- **Phase 2 — selective Valtio migration**: planned `state/dataStore.ts` holding `postsByChannel`/`users`/`userImages`/`userStatuses`/`typingUsers` with narrow per-row selectors, mirroring `uiStore`/`useChannelPreferences`. Conditional on re-measurement showing re-render scope persists after Phase 1. Full plan + measured baseline in `docs/design/2026-08-11-rendering-smoothness-and-selective-valtio-migration-design.md`.

## Verification
- `bun test` (full suite), `bunx @biomejs/biome check <files>`, and `bunx tsc --noEmit -p tsconfig.json` grepped for changed-file names (whole-project typecheck has known pre-existing CSS-import errors — ignore those).
