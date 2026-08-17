# Timeline scroll professionalism + e2e observability harness — Design

- **Date:** 2026-08-14
- **Status:** Approved (design-only session; implementation to follow)
- **Related skills:** `antimatter-mui-timeline-render-perf`, `antimatter-chat-workspace-startup-loading`
- **Related prior design:** `2026-08-11-rendering-smoothness-and-selective-valtio-migration-design.md`

## 1. Problem statement

The MUI headless timeline (`src/mainview/components/mui-headless-timeline/MuiMessageTimeline.tsx`) has three user-facing scroll defects that make it feel unprofessional next to Discord/Slack:

1. **Pin loss after idle:** Scroll to the bottom, pause ~2s, and the viewport jumps up a few messages so it is no longer at the bottom.
2. **Non-deterministic open position:** Opening a chat lands somewhere in the middle of the timeline with no reliable way to predict where.
3. **Blank timeline on load-more while scrolling down:** When older messages are loading and the user scrolls down, the entire timeline renders black until the next scroll event.

### Research findings (root-cause hypotheses, ranked by confidence)

Findings from reading the component, `@mui/x-chat-headless@9.0.0-alpha.16` internals (`useMessageListBehavior.mjs`, `MessageListRoot.mjs`), the data flow in `MainViewApp.tsx`, and the attachment/image render path:

- **F1 — Late image layout shift (high confidence, feeds symptoms 1 and 2).** Attachments render a tiny text placeholder until the image loads; only then does `MessageAttachments.tsx` apply an `aspect-ratio` frame from `useImageLoadInfo` (up to 360px tall, per `.inline-image-frame` CSS). Images resolve asynchronously through the Electrobun RPC (`api.getFileDataUrl`), so each image commit changes content height after initial render. The library's resize handler (`scheduleResizeRestore`) only re-pins to bottom **while streaming**; outside streaming, a resize with `isAtBottom === true` calls `updateIsAtBottom()` but never re-scrolls — so growing content silently pushes the bottom away. Compounding this, our `MattermostFileInfo` type (`src/mainview/types.ts`) omits the `width`/`height` fields the Mattermost API actually returns, so we currently cannot reserve space even though the metadata exists.
- **F2 — Library re-pin is streaming-only (high confidence, symptom 1).** In `useMessageListBehavior.mjs`, the row-`ResizeObserver` path calls `scrollToBottom()` only when `isAtBottom && autoScrollEnabled && isStreaming`. Antimatter never streams (adapter is a no-op `ReadableStream`), so any height change while parked at bottom (image load, late avatar, reaction pill arrival, code-block font metrics settling) leaves the viewport above the new bottom. The user perceives this as "jumped up a few messages."
- **F3 — Competing anchoring authorities (high confidence, symptoms 2 and 3).** Three mechanisms fight over `scrollTop`: (a) WebKit's native scroll anchoring (`overflow-anchor` default), (b) the library's `captureAnchor`/`restoreAnchor` compensation on prepend and resize, (c) our app-level `scrollToBottom` effect in `MuiMessageTimeline.tsx` (~line 194) which fires twice (sync + rAF) per channel/last-message change. During load-more, a prepend is classified by `classifyItemChange` and `restoreAnchor` runs in a layout effect; if WebKit already performed its own anchor adjustment on the same mutation, the compensations double-apply — visible as drift, jump, or (when the scroller's paint is invalidated mid-compensation) the black-flash.
- **F4 — Open-position race (medium-high confidence, symptom 2).** The app effect scrolls to bottom when `lastMessageId` first appears, but the commit that lands posts and the commits that follow (images resolving, members/avatars arriving, `loading` flag flip) change height afterward with nothing to correct the position (see F2). Where you land depends on how many late commits occurred and their magnitude — hence "no discernible or reliable way to know where."
- **F5 — No reproduction/observability environment (high confidence, meta).** Everything above is inferred from source reading. `bun test` server-renders (`renderToString`), so no scroll behavior, layout, or paint is ever exercised. The WKWebView cannot be automated directly. There is no way to distinguish "anchor drift" from "paint suppression" from "layout thrash" today, and no regression net for any fix.

## 2. Goals and non-goals

**Goals**

- A real e2e environment that runs the actual timeline component in a real WebKit-family browser with deterministic fixtures, driven from scripts — so scroll behavior is observable, measurable, and regression-guarded.
- Fix the three symptoms using that environment to prove cause and effect.
- Professional scroll UX: open at the settled bottom; stay pinned while at rest at bottom; anchor-preserving load-more with no blank flash.

**Non-goals (explicitly out of scope for this milestone)**

- Virtualization/windowing of the timeline (candidate future milestone; the harness would de-risk it).
- Real Mattermost server in Docker as an e2e backend (the harness stubs the API surface instead).
- Any work on the legacy `MessageTimeline.tsx` (being retired) or on the composer.
- Wiring e2e into CI (user decision: **local/dev-only** for now, via `bun run test:e2e`; revisit later).

## 3. E2E harness design

### 3.1 Why this shape

- **Engine correction (2026-08-14, implementation):** the original plan to drive *system* Safari via Playwright's `safari` channel is not implementable — Playwright has no `safari` channel (its WebKit is a patched build; the branded Safari/safaridriver cannot be driven). The harness therefore runs Playwright's bundled WebKit build (`bunx playwright install webkit`, one-time local download), which tracks WebKit main and is a close match for the production WKWebView, with a chromium project as cross-check. Both engines reproduced identical baseline numbers.
- Mounting `MuiMessageTimeline` standalone (not `MainViewApp`) keeps the harness deterministic: chatDataStore is seeded exactly like `MuiMessageTimeline.test.tsx` does, and `resolveImageSrc` is stubbed with configurable latency returning generated SVG data URLs of exact dimensions — making image-driven layout shift real and controllable.
- The in-page control object (`window.__harness`) plus rAF-sampled scroll telemetry turn subjective jank into numbers: `scrollTop`/`scrollHeight`/`clientHeight` time series, scroll-event counts, and frame gaps.

### 3.2 Components

- `tests/e2e/harness/harness.tsx` + `index.html` — standalone page mounting `MuiMessageTimeline` inside a fixed-height chat shell, seeding `chatDataStore` (users, settings, currentUser, resolveImageSrc stub).
- `tests/e2e/harness/fixture.ts` — post factory: N messages across K authors, configurable markdown mix (code blocks, long paragraphs), optional attachments **with and without dimensions**, timestamps spread across days (date dividers).
- `tests/e2e/harness/api.ts` — in-page control exposed as `window.__harness`:
  - `openChannel({postCount, imageFraction, imageDelayMs})`
  - `loadMore({count, latencyMs})` — wired through the real `onLoadMore` prop so the real `canLoadMore` gating and store flags run
  - `appendMessages(...)` — simulates incoming posts
  - `settle()` — resolves all pending stubbed image promises
  - `getScrollTrace()` — telemetry: rAF-sampled `{t, scrollTop, scrollHeight, clientHeight}` + scroll-event counter, sampled continuously while a scenario is active
- `tests/e2e/server.ts` — small `bun` static server; harness page bundled with `bun build` (or esbuild) to a temp dir.
- `tests/e2e/*.spec.ts` — Playwright specs:
  - Project 1: `webkit` (Playwright bundled WebKit) — primary; see the engine correction in §3.1.
  - Project 2: chromium — cross-check where available; webkit-only assertions (paint behavior) conditioned on browser.
  - Implemented as `tests/e2e/scroll.e2e.ts` (the `.e2e.ts` suffix keeps the files out of `bun test`'s spec discovery); run via `bun run test:e2e` (local/dev-only).
- `package.json`: devDependency `@playwright/test`; script `test:e2e`.

### 3.3 Black-screen detection (symptom 3 as a number)

Per-scenario screenshot of the timeline rect, downsampled, scored for pixel uniformity: a fully unpainted region scores as uniform dark. Threshold chosen so a normal timeline (text/background variance) passes and a blank scroller fails. Applied in the load-more scenario before/after the scroll gesture.

## 4. Regression scenarios (acceptance gates)

Each scenario maps to one user symptom and runs red on current code:

1. **Pin stability (symptom 1).** Open channel with image-bearing history → scroll to bottom → `settle()` images → wait 3s idle. Assert `scrollHeight − clientHeight − scrollTop ≤ 96` (the app's `autoScroll.buffer`) for the entire trace tail. No jump-up after settle.
2. **Open-at-bottom (symptom 2).** `openChannel` with 300 messages, 30% images. Assert within 1s of posts arriving that the last message element is fully in view, and remains so through image settle (drift ≤ buffer).
3. **Load-more integrity (symptom 3).** Open channel → trigger `onReachTop` with ~400ms latency → immediately mouse-wheel downward through the prepended region. Assert: (a) anchor drift ≤ 24px across the prepend commit, (b) no uniform-dark screenshot region, (c) no multi-frame telemetry stall > 150ms, (d) no eager second page load until the user re-reaches top.

### 4.1 Baseline recorded on current code (2026-08-14, harness milestone)

Scenarios 1 and 2 are red on both webkit and chromium with identical numbers — pin loss and open-off-bottom are confirmed, deterministic, image-driven layout shift:

- Scenario 1 (pin stability): worst distance-from-bottom after image settle = **1569px** (allowed ≤ 96px).
- Scenario 2 (open-at-bottom): after image settle the last message sits **1549px below** the viewport (distance-from-bottom 1569px), though it *was* in view within 1s before the images resolved.
- Scenario 3 (load-more integrity) is **green** on bundled WebKit and chromium (anchor drift 0.0px, max frame gap 21ms/9ms, no uniform-dark region, no eager second load). Conclusion: the load-more black flash does not reproduce in Playwright's engines with this fixture — consistent with it being a WKWebView paint behavior. Symptom 3 therefore relies on the manual WKWebView checklist for validation; this spec stays as the regression gate for anchoring/paint regressions, and §5c's keep-or-drop measurement now has its "before" numbers recorded above.

## 5. Phase-1 fixes

### 5a. Stick-to-bottom controller (symptom 1; most of 2)

**STATUS (2026-08-14): implemented** as `TimelineScrollKeeper.tsx`, rendered via `MessageList.Root`'s `overlay` slot. Reads `{ isAtBottom, scrollToBottom }` from `useMessageListContext()`; observes `.mui-message-list-content` with a ResizeObserver and re-pins on content-height changes. The channel-switch effect in `MuiMessageTimeline.tsx` was simplified to the single initial pin (the rAF double-scroll is gone; the keeper owns late corrections).

New `TimelineScrollKeeper` component rendered via `MessageList.Root`'s `overlay` slot (the only app-reachable spot inside `MessageListContextProvider`):

- Reads `{ isAtBottom, scrollToBottom }` from the exported `useMessageListContext()`.
- Attaches a `ResizeObserver` to `.mui-message-list-content` (located via `closest('.mui-message-list-root')` from the overlay element).
- On any content-height change **while `isAtBottom` is true**, calls `scrollToBottom()`.
- This generalizes the library's streaming-only re-pin into the Discord/Slack behavior (follow the bottom while the user is parked there, stop the moment they scroll up — `isAtBottom` flips false beyond the 96px buffer and the keeper goes inert).
- The existing app effect (`MuiMessageTimeline.tsx` ~line 194) remains responsible for channel switches but is simplified once 5d lands (single owner of "open" semantics; keeper owns "stay" semantics).

### 5b. Image space reservation (feeds 1 and 2)

- Extend `MattermostFileInfo` (`src/mainview/types.ts`) with optional `width`/`height` — the Mattermost API returns them; our type simply omits them today.
- `MessageAttachments` renders the aspect-ratio frame immediately from metadata instead of waiting for load. `useImageLoadInfo` remains the fallback when metadata is absent.
- Markdown-embedded images (no server metadata available) get a bounded placeholder frame (fixed height ≤ 240px, consistent with the 360px max) so attachment shift is eliminated and markdown shift is capped.
- Load-more black-flash note: the harness load-more scenario measures whether 5b alone reduces the flash, since reserved frames remove a large class of post-prepend reflow.

### 5c. Single anchoring authority (symptom 3 contributor; general jank)

**STATUS (2026-08-17): kept.** Added `overflow-anchor: none` to `.mui-message-list-scroller` in `MuiMessageTimeline.css` so WebKit's native anchoring stops racing the library's `restoreAnchor`. Measured with `bun run test:e2e -- --grep "scenario 3"` before and after the CSS change:

- Before 5c after 5b: `anchorDrift=0.0px`, `maxFrameGap=19ms`, `scrollEvents=0`.
- After 5c: `anchorDrift=0.0px`, `maxFrameGap=17ms`, `scrollEvents=0`.

Decision: keep. The Playwright WebKit prepend scenario remains neutral/slightly better, with no anchor drift, blank flash, frame stall, or eager second load. Baseline "before" numbers: §4.1.

### 5d. Settled open (symptom 2)

**STATUS (2026-08-14): implemented** inside the keeper: settle starts on channel switch/open (detected in the RO callback), re-pins on every content-height change, ends when the height is stable for 200ms (bounded at 2s). `loadMoreReadyChannelId` gating is preserved.

**Engine findings recorded during implementation (input for 5c):**

- **Native scroll anchoring is active in the scroller and is load-bearing for readers.** When a user is parked mid-history and images load above them, the engine shifts `scrollTop` to preserve the reading position (scenario 1b: same visible row before/after, 0.2px shift). `scrollTop` itself moving is correct behavior, not coercion — scenario 1b therefore asserts on the visible row, not the scroll offset.
- **Anchoring-induced scroll events fire *before* ResizeObserver callbacks in the same frame, and engines differ in whether the adjustment is visible to the RO callback.** A "was at bottom" verdict computed from post-layout geometry is unreliable in both directions (webkit: stale position causes false pins on parked readers; chromium: compensated position defeats legitimate pins). The keeper therefore tracks at-bottom in its own scroll listener and skips events whose `scrollHeight` no longer matches the last observed content height — those are anchoring artifacts, not user intent.
- **A pin necessarily trails its commit by one frame** (commit → RO → scrollToBottom ≈ 16–20ms). Scenario 1 therefore asserts no *sustained* departure (streak above the 96px buffer ≤ 150ms) plus final position at bottom, not a max over all samples.

**Measured after 5a+5d (webkit / chromium, both green):** scenario 1 worst streak 19–20ms / 5ms, final distance 0px; scenario 2 last message fully in view, distance 0px; scenario 1b visible row unchanged; scenario 3 unchanged (drift 0.0px). Baseline "before" numbers: §4.1.

Replace the fire-twice `scrollToBottom` in the channel-switch effect with a settle protocol, implemented inside `TimelineScrollKeeper` (one owner of pin semantics instead of three):

- On channel switch/open: set stick = true.
- Re-pin on each content `ResizeObserver` tick until content height is stable for 200ms (bounded at ~2s total).
- Then release control to the user (stick = false; normal keeper behavior resumes).
- Existing `loadMoreReadyChannelId` gating (prevents load-more firing before the initial pin lands) is preserved as-is; the keeper's stick window subsumes the double-rAF hack.

## 6. Testing strategy

- **Unit (Bun, server-render):** keeper renders inert without DOM measurements; `MattermostFileInfo` type extension compiles and attachment frame renders aspect-ratio from metadata (extend `MessageAttachments` tests if present, else the mui-timeline tests; follow the existing `renderToString` patterns).
- **Harness specs:** the four scenarios in §4 — the acceptance gate for each fix (TDD: red → fix → green).
- **Manual checklist against the real app** for final sign-off (WKWebView itself can't be automated): the three repro scripts, plus split-panel ChatWorkspace restore, since the harness mounts the timeline standalone.
- **Standard gates:** `bun test`, `bun run typecheck`, `bunx @biomejs/biome check .`, `bun run build`.

## 7. Implementation order

1. Harness + red specs (evidence base; nothing ships from this step).
2. 5a + 5d together (one owner of pin semantics).
3. 5b.
4. 5c (measured, keep-or-drop).

Beads issue per milestone; TDD throughout — spec red before each fix, green after.

## 8. Future milestones (recorded, not scheduled)

- Timeline windowing/virtualization (`@tanstack/react-virtual` is already a dependency; `estimatedItemSize` is already passed) — de-risked by this harness.
- Real-Mattermost-in-Docker e2e mode behind the same harness API.
- CI wiring for `test:e2e` (user deferred).

## 9. Risks and mitigations

- **`overflow-anchor` removal could regress prepend anchoring on some engine version** — mitigated by the measured before/after in scenario 3 and keep-or-drop decision rule.
- **Overlay slot is undocumented surface** — it is a stable prop of `MessageListRoot` in the pinned alpha; if it misbehaves, fallback is a portal into the scroller's parent from the app root (slightly more DOM coupling, same behavior).
- **Harness fidelity** — the harness is not the WKWebView; it runs Playwright's bundled WebKit (see §3.1). Paint-level findings (black flash) could not be reproduced in Playwright engines at baseline (§4.1), so they are validated against the manual WKWebView checklist before any fix is considered proven.
- **Stick-to-bottom fights user intent** — the 96px `isAtBottom` buffer already defines "at bottom"; keeper only acts while that is true, and the pin-stability scenario explicitly verifies no coercion while scrolled up.
