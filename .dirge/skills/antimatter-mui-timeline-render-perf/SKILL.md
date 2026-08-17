---
name: antimatter-mui-timeline-render-perf
description: Diagnose and fix rendering jank in Antimatter's MUI X Chat headless timeline. Covers perfTrace instrumentation, the renderer data flow, and the memoization levers (markdown value-comparator memo, posts-array-reference memoization in buildTimelineRows, per-message ChatMessage object cache in buildMuiTimelineMessages). Use when the chat timeline feels janky, over-renders on incoming messages/avatars/presence, or when measuring render perf before/after a timeline change.
---

# MUI timeline rendering performance

## Stale or missing messages are NOT a memoization bug
The caches documented here (buildTimelineRows posts-array memo, the per-message ChatMessage object cache, getStablePanelPosts element-identity check) were exonerated for the "tabbed chats never load newer messages" bug (Beads antimatter-4q5, fixed in commit 1c89715) — they recompute whenever the posts array or element references change. Stale or missing messages in chat tabs point at history loading instead: selectChannel serving a stale SWR history cache, websocket `posted` handling for non-selected channels, or refreshAfterReconnect coverage. See the antimatter-chat-workspace-startup-loading skill.

## When to use
- The MUI headless chat timeline (`src/mainview/components/mui-headless-timeline/`) feels janky, stutters on scroll, or over-renders.
- A change touches the timeline, the posts/users/avatars/presence data flow, or markdown rendering, and you need a before/after measurement.
- You want to add or extend a memoization cache for message rendering.

## The renderer data flow (read this first)
The MUI timeline is the **canonical** one (branch `replace-timeline-mui-chat`); legacy `components/MessageTimeline.tsx` is being retired — don't invest in it.

Renderer data **originates in `useState`** but the MUI timeline now consumes the lookup half from Valtio:
- Origins: `NormalizedState` (flat `posts` Record, `postOrder`, `users`, `channels`) — `useState` in `app/MainViewApp.tsx` (~line 216). `userImages`, `userStatuses`, `userColors`, `settings` — `useState` in `features/users/useUserPresence.ts`. `typingUsers` in Valtio `state/uiStore.ts`.
- MainViewApp mirrors the lookup data into `state/chatDataStore.ts` via `chatDataActions.setSettings/setUsers/setUserColors/setUserImages/setUserStatuses/setCurrentUser/setApi/setChannelsById/setResolveImageSrc` effects (~lines 1575-1601). `chatDataStore` does NOT hold `posts`/`postOrder`.
- `MuiMessageTimeline` reads `useSnapshot(chatDataStore)` and builds the `MuiTimelineContextValue` from `data.settings/users/userColors/userImages/userStatuses/currentUserId/currentUser/resolveImageSrc`. Per-instance data (`posts`, `channel`, `channelId`, handlers) is still passed as explicit `MuiMessageTimelineProps`.
- The "selective Valtio migration" Phase 2 below has **landed at the store level** (whole-snapshot `useSnapshot`, not narrow per-row selectors); the per-row-selector optimization is still pending.
- Mounts at **two sites**: `app/ChatShell.tsx` (~520) and `components/ChatWorkspace.tsx` (~208).

Amplifier: `MuiTimelineProvider` (`MuiTimelineContext.tsx`) builds a **fresh value object every render**, so every `useMuiTimelineContext()` consumer re-renders regardless of `React.memo`. This is the dominant re-render-scope cause.

## Rendering correctness: settings-driven visuals
Not every setting reaches the MUI DOM through React props/state — some flow through CSS variables or MUI `ownerState`, which can mask a setting that "doesn't update live":
- **Own-message indicator** (`AppSettings.showOwnMessageIndicators`, UI "Indicate my messages", checkbox id `show-own-message-indicators`): MAIN message bubbles get the `.own` class from MUI's role-based `ownerState.isOwnMessage` (`MuiTimelineSlots.ts`), which ignores the setting. The accent bar itself is the `--own-message-indicator-color` CSS var (consumed by `.mui-message-root.own::before` and `.mui-message-bubble.own` in MuiMessageTimeline.css). So the toggle only takes effect live if `MuiMessageTimeline`'s root `style` gates that var to `transparent` when the setting is off. REPLY rows (`MuiTimelineReplies.tsx`) compute `isOwnMessage = context.settings.showOwnMessageIndicators && reply.user_id === context.currentUserId` directly, so they honor the toggle without this.
- General lesson: when a settings toggle "doesn't take effect" in this timeline, first check whether the visual is driven by a CSS variable or an MUI `ownerState` (both bypass React re-renders from the store) rather than a prop/`useSnapshot` read.

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

## How the scroll-up load-more trigger is gated
`MuiMessageTimeline` fires scroll-up fetches only when `canLoadMore` is true. `canLoadMore` AND-gates: `context.onLoadMore` is set, `!context.loadingHistory`, a per-channel end-of-history flag (`chatDataStore.hasMoreHistoryByChannel[context.channelId ?? ""] ?? true` — default `true` so pre-first-load behavior is unchanged), and `loadMoreReadyChannelId === context.channelId` (that last one prevents firing before the initial scroll-to-bottom lands — see the "Opens above the bottom" defect below). `MuiHistoryStateBridge` mirrors the same flag into the MUI store's `hasMore`: `(hasMoreHistory && Boolean(context.onLoadMore))`, with `chatData.hasMoreHistoryByChannel`, `context.onLoadMore`, `context.loadingHistory`, and `context.channelId` in the effect deps. The end-of-history flag is written from `Boolean(postList.prev_post_id)` in both `loadChannelHistory` (initial, in MainViewApp) and `loadMoreMessages` (incremental), placed before the history merge so exhaustion is recorded even if a later step throws. `PostListResponse.prev_post_id` (typed in `src/mainview/types.ts`) is the server's "older history exists" signal — falsy at the channel start. Note: accessing `hasMoreHistoryByChannel` reads through a Valtio `useSnapshot(chatDataStore)`, so keep that field as a plain `Record` (see the valtio-migration skill's replace-not-mutate pitfall for the setter).

## Image layout-shift space reservation
Use this when timeline scroll stability issues involve late image sizing. Mattermost image attachments render through `src/mainview/components/MessageAttachments.tsx`; markdown image renderers live in both `src/mainview/components/MarkdownMessage.tsx` and the `@uiw` wrapper path in `src/mainview/components/MessageMarkdown.tsx`.

Durable implementation pattern:
- Add or keep optional `width?: number` and `height?: number` on `MattermostFileInfo` and `MattermostUploadedFile` in `src/mainview/types.ts`; Mattermost file metadata can carry real image dimensions and the renderer should not drop them.
- For image attachments, derive `.inline-image-frame` style from positive metadata dimensions before `useImageLoadInfo` resolves, using `aspectRatio: width / height` and bounded width such as `Math.min(width, 520)`. Keep the failed-image branch before the metadata placeholder branch so failed resolved images still show the existing fallback text instead of staying in a reserved placeholder.
- For markdown images without server metadata, reserve bounded unknown-image space before load with `.markdown-image-frame.loading` and `height: 240` in both markdown renderer paths.
- E2E image fixtures in `tests/e2e/harness/fixture.ts` should include deterministic dimensions from `IMAGE_DIMENSIONS`; otherwise scroll e2e tests may not exercise the metadata-backed reservation path.
- For `.ts` tests that server-render React components, use `createElement` instead of JSX. For markdown image SSR tests, use a normal URL such as `/files/image.png`; `mattermost://...` can be stripped by the markdown parser and never reach the image component.

Focused verification for image space reservation:
- `bun test src/mainview/components/MessageMarkdown.test.ts src/mainview/components/mui-headless-timeline/MuiMessageTimeline.test.tsx`
- `bun run typecheck`
- `bun run test:e2e`
- `bunx @biomejs/biome check <touched files>`
- `bun test`
- `bun run build`

## MessageList DOM / slot architecture (for layout / scroll CSS work)
Internals live at `node_modules/@mui/x-chat-headless/message-list/MessageListRoot.mjs` → `StaticMessageListView` (v9.0.0-alpha.16). Rendered DOM, with the class names Antimatter assigns via `muiTimelineSlotProps` (`MuiTimelineSlots.ts`):
- `.mui-message-list-root` — the `ScrollRoot` slot. Its DIRECT children are the scroll viewport AND a sibling custom scrollbar (`ScrollScrollbar`/`ScrollThumb`) the headless library renders itself; the thumb is driven off the viewport's scroll metrics.
- `.mui-message-list-scroller` — the `messageListScroller` slot = the real `overflow-y:scroll` element AND the behavior root ref holder (what `MessageListRootHandle.scrollToBottom` / `onReachTop` measure against).
- `.mui-message-list-content` — the `messageListContent` slot, single child of the scroller.
- message rows — each a plain normal-flow `<div style="width:100%" data-message-list-row>` child of `.mui-message-list-content`. There is NO absolute/transform spacer and NO `getVirtualItems`/`useVirtualizer` in `MessageListRoot.mjs` in this version, despite `estimatedItemSize` being passed. So ordinary CSS layout (flexbox, margins) moves the rows — do NOT assume @tanstack/react-virtual absolute offsets that would defeat flex alignment.

### Scroll behavior internals & scroll-jank findings (v9.0.0-alpha.16)
Scroll logic lives in `node_modules/@mui/x-chat-headless/message-list/useMessageListBehavior.mjs`:
- Classifies message-id array changes as append/prepend/other (`startsWithSequence`/`endsWithSequence`) and manually restores the anchor element on prepend.
- `isAtBottom` ⇔ `scrollHeight - clientHeight - scrollTop <= autoScrollBuffer` (default 150px). Auto re-pin fires for appends while at bottom (streaming-oriented) — there is NO general stick-to-bottom when content height changes for other reasons (images loading, late layout shifts).
- `useMessageListContext()` is exported from the package root and exposes `{ isAtBottom, scrollToBottom }`; `MessageListRoot`'s `overlay` slot renders inside `MessageListContextProvider`, making it the only app-reachable mount point for a custom pin controller (reach the scroller via `closest('.mui-message-list-root')`).

### TimelineScrollKeeper (stick-to-bottom + settle re-pin) — landed
`src/mainview/components/mui-headless-timeline/TimelineScrollKeeper.tsx`, mounted in `MuiMessageTimeline` as `<MessageList.Root overlay={<TimelineScrollKeeper ... />}>`. Design: `docs/design/2026-08-14-timeline-scroll-professionalism-design.md` §5a+5d; Beads `antimatter-068`.
- Re-pins via `useMessageListContext().scrollToBottom` when content height changes (ResizeObserver) within a 2s settle window that resets on each content change; never coerces a user scrolled above the bottom. "No coercion" tests must assert the visible row (by DOM id) and its `getBoundingClientRect().top` delta (≤2px), not `scrollTop` — native scroll anchoring is *supposed* to move scrollTop while preserving the reading position.
- **Engine scroll-order race (key pitfall):** chromium fires the scroll-anchoring scroll event BEFORE the ResizeObserver callback; webkit after. Recomputing "was at bottom" from live geometry in the RO callback reads post-anchoring scrollTop on chromium and wrongly rejects re-pins (chromium-only ~1569px open-at-bottom miss while webkit stayed green). Fix: compute and store `wasAtBottom` inside the scroll listener, where `scrollTop`/`scrollHeight`/`clientHeight` are self-consistent; the RO callback reads the stored boolean. `shouldRePin` signature: `{ buffer, isAtBottom, lastHeight, settle, wasAtBottom }`.
- Pin-stability e2e assertions must check SUSTAINED departures (no streak above the buffer > ~150ms plus final distance at bottom), not single-frame transients — content growth necessarily outruns the pin by one RO frame.
- E2e: `bun run test:e2e` runs Playwright with `webkit` (Playwright's bundled WebKit build — there is no `safari` channel in this Playwright version) as primary and `chromium` as cross-check; scroll specs must pass on BOTH engines. Harness: `tests/e2e/harness/` + `tests/e2e/server.ts`.
- Antimatter sets no `overflow-anchor` on `.mui-message-list-scroller`, so WebKit's native scroll anchoring races the library's manual anchor restore on prepend (suspected load-more jank/black-screen contributor). Candidate fix: `overflow-anchor: none` — measure in the harness, drop if it regresses.

Confirmed late-layout-shift source (feeds "jump up after settling at bottom" and "opens mid-timeline"): `MattermostFileInfo` in `src/mainview/types.ts` omits the `width`/`height` fields the Mattermost API actually returns, and `MessageAttachments` renders the aspect-ratio frame only once `useImageLoadInfo` reports `state === "loaded"`. Until the async `resolveImageSrc` → `api.getFileDataUrl` Electrobun RPC resolves, the row is a ~20px placeholder that then jumps to up to 360px (frame: `width: min(100%, 420px); max-height: 360px`). Fix: add optional `width`/`height` to `MattermostFileInfo` and reserve space from metadata immediately; keep `useImageLoadInfo` as fallback for markdown-embedded images with no metadata.

Approved Phase-1 design from the scroll-jank research session (design doc still TO BE WRITTEN into `docs/design/`):
1. Playwright+WebKit e2e harness FIRST, red regression specs before any fix: `tests/e2e/harness/` standalone page mounting `MuiMessageTimeline` directly (seed `chatDataStore` the way `MuiMessageTimeline.test.tsx` does), stub `resolveImageSrc` with delayed SVG data URLs of exact dimensions, expose a `window.__harness` control object (`openChannel`, `loadMore` through the real gate, `appendMessages`, `settle`, rAF-sampled `{t, scrollTop, scrollHeight, clientHeight}` trace). Run with `channel: "safari"` (system WebKit matches the production WKWebView engine); chromium optional cross-check. Black-screen detection via screenshot pixel-uniformity on the timeline rect. E2E IS DEV-ONLY (`bun run test:e2e`) — user explicitly chose NOT to wire it into CI.
2. `TimelineScrollKeeper` component via the overlay slot: ResizeObserver on `.mui-message-list-content`, `scrollToBottom()` on height change while `isAtBottom`; on channel open, re-pin each resize tick until height is stable for 200ms (bounded ~2s), then release to the user. One owner of pin semantics replaces the app's fire-twice effect (`MuiMessageTimeline.tsx` ~line 194).
3. Image space reservation from `MattermostFileInfo` metadata (above).
4. `overflow-anchor: none` on the scroller (measured in harness; strictly-better-or-drop).

### Bottom-anchoring short lists to the bottom
Chat clients bottom-anchor so a channel with few messages parks them just above the composer (instead of parked at the top with whitespace below). Gotcha that cost a scrollbar: do NOT turn `.mui-message-list-scroller` into a flex container. The viewport is the behavior root and a sibling custom scrollbar reads its scroll metrics; flexing the viewport perturbs that measurement and the scrollbar disappears. Bottom-anchor at the CONTENT layer instead — in `MuiMessageTimeline.css`:
```css
.mui-message-list-scroller { /* leave as plain overflow-y:scroll block */ }
.mui-message-list-content {
  padding: 16px 20px 20px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
```
`min-height` (not `height`) lets long lists overflow and scroll normally, so `onReachTop` history-load and `scrollToBottom` are unaffected — only short lists pin to the bottom. Verified: 25 timeline tests pass, biome clean, typecheck clean.

## Known remaining issues (deferred)
- **"Opens above the bottom" scroll defect** — channel opens a few messages above the true bottom; the double `scrollToBottom` + `requestAnimationFrame` + `setLoadMoreReadyChannelId` in `MuiMessageTimeline.tsx` (~lines 171-191) is the suspect. Not yet fixed.
- **Stabilizing `renderItem` identity** — deliberately skipped; the per-message cache (lever 3) lets `MuiMessageItem` memo bail regardless. Revisit only if re-measurement shows `MessageList` bookkeeping cost.
- **Phase 2 — selective Valtio migration**: planned `state/dataStore.ts` holding `postsByChannel`/`users`/`userImages`/`userStatuses`/`typingUsers` with narrow per-row selectors, mirroring `uiStore`/`useChannelPreferences`. Conditional on re-measurement showing re-render scope persists after Phase 1. Full plan + measured baseline in `docs/design/2026-08-11-rendering-smoothness-and-selective-valtio-migration-design.md`.

## Verification
- `bun test` (full suite), `bunx @biomejs/biome check <files>`, and `bun run typecheck` (whole-project `tsc --noEmit`). As of late 2026 this passes cleanly with 0 errors — the old pre-existing TS2882 CSS-import errors are gone, so treat any new `error TS` as real and fix it; don't dismiss typecheck failures as pre-existing.
