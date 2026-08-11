# Rendering Smoothness Investigation + Selective Valtio Migration

**Date:** 2026-08-11
**Status:** Work complete (2026-08-11). Phases 0, 1a, 1c shipped and verified; 1b/1d/1e, Phase 2, Phase 3 deferred by the owner. This doc is the living ADR / re-investigation guide.
**Branch context:** `replace-timeline-mui-chat`

## Outcome (2026-08-11)

**Shipped and measured:**

- Phase 0 — `src/mainview/utils/perfTrace.ts` instrumentation (off by default;
  enable with `localStorage.setItem("mm-clone:perf", "1")`). Kept in-tree as the
  shared yardstick.
- Phase 1a — `MarkdownRenderer` wrapped in `memo` with a value comparator
  (`markdownPropsEqual`). Eliminates markdown re-parse on unrelated re-renders.
- Phase 1c — `buildTimelineRows` memoized by posts-array reference, and
  `buildMuiTimelineMessages` reuses per-message `ChatMessage` objects via a
  module cache (invalidated per post/replies/author/avatar/status/color;
  channel change clears it; size capped at 1000). This is what lets
  `MuiMessageItem`'s and `MattermostTextPart`'s `memo` bail out.

**Measured result (Scenario A, startup):** over-render went from ~10–18× down
to ~1×; `MattermostTextPart` 116 → 61 (~1:1 with visible items = mount floor);
`MarkdownRenderer` absent from counts; `buildMuiTimelineMessages` rebuilds now
0–1 ms after the first cold parse. The render half of the reported jank is
resolved.

**Deferred by the owner (rationale recorded for future reference):**

- 1b (split the timeline Context so part renderers don't re-render on
  unrelated value changes) — superseded by 1c's cache; revisit only if a live
  burst shows residual re-render scope.
- 1d/1e (channel opens a few messages *above* the bottom — scroll-to-bottom
  lands short of the true bottom) — accepted for now; this is the most likely
  item to revisit.
- Phase 2 (Valtio migration of the renderer data path) — urgency reduced: 1c's
  per-message cache already delivers the narrow per-user revalidation that was
  Phase 2's rationale, so migration is now ergonomics-only, not perf.
- Phase 3 (workspace store) — not indicated.

**If jank returns, re-investigate in this order:**

1. Re-enable the perf flag and re-run Scenarios A/B/C; compare against the
   recorded numbers in the "Appendix: Phase 0 profiling runbook."
2. If over-render returns → the per-message cache invalidation
   (`buildMuiTimelineMessages` in `muiChatModels.ts`) or the `MarkdownRenderer`
   memo (`markdownPropsEqual`) is the suspect.
3. If the symptom is scroll/position (opens off-bottom, jumps on load-more)
  → Phase 1d/1e is the fix path; start from the `scrollToBottom` effect in
   `MuiMessageTimeline.tsx`.
4. If a *specific* state slice starts causing render storms (e.g., a new
   high-frequency stream) → that is the one case where Phase 2 (Valtio with
   narrow per-slice subscriptions) is genuinely warranted.

## Goal

Make Antimatter's chat timeline render as smoothly as the official Mattermost
client, and improve developer ergonomics by consolidating state management onto
Valtio. Decided order of operations: **jank first, Valtio as a lever** — measure,
apply targeted rendering fixes, then migrate state only where profiling proves
re-render scope is the cause.

## Background

Two decisions up front:

- The **MUI headless timeline** (`src/mainview/components/mui-headless-timeline/`)
  is the canonical target. We stop investing in the legacy
  `MessageTimeline.tsx`.
- The approach is **A — profile → cheap fixes → selective Valtio migration**,
  not a blanket migration of every `useState`.

The project already has a small but real Valtio footprint:

- `src/mainview/state/uiStore.ts` — `proxy` + `uiActions` for UI flags.
- `src/mainview/features/channels/useChannelPreferences.ts` — `proxy` +
  `useSnapshot` for sidebar/composer preferences.

These are the patterns to **extend**, not reinvent.

## Known hot paths (from code inspection)

These were identified before profiling and are the leading jank candidates:

1. **Markdown re-parse on every render.** `MarkdownMessage.tsx:27` runs
   `ReactMarkdown` + `remarkGfm` on every render of any visible row. The only
   memoization is the mention-highlight transform
   (`highlightMentionsInMarkdown`); the actual markdown→React parse is not
   cached by content. Any re-render of a visible row re-parses every visible
   message. No state library fixes this.

2. **`renderItem` rebuild churn in `MuiMessageTimeline.tsx:84-164`.** The
   `messages` / `messageById` / `messageIds` / `renderMessageItem` chain is
   rebuilt whenever `context.posts` (and `users`, `userImages`,
   `userStatuses`...) changes identity. That data currently lives in
   `useState` inside `MainViewApp` and is threaded down via props/Context, so
   an unrelated update (typing indicator, ws status, dialog open) can
   invalidate `renderItem`, causing `MessageList` to re-render every visible
   item.

3. **Scroll churn in `MuiMessageTimeline.tsx:166-186`.** A double
   `scrollToBottom` (synchronous + `requestAnimationFrame`) plus a
   `setLoadMoreReadyChannelId` re-render on every channel load / new last
   message. This fights `autoScroll` during rapid incoming messages.

4. **Static `estimatedItemSize={112}` (`MuiMessageTimeline.tsx:223`).** With
   variable-height content (markdown, images, replies), a static estimate
   causes scroll jumpiness unless `measureElement` is tuned.

## Scope

**In scope:**

- Establish a performance baseline and a repeatable before/after measurement.
- Targeted rendering fixes that do not require a migration (markdown cache,
  `renderItem` stabilization, scroll churn, virtualization tuning).
- Selective Valtio migration of the state slices confirmed to cause re-render
  storms — almost certainly the renderer data path (`posts`, `users`,
  `userImages`, `userStatuses`, `typingUsers`) currently held in
  `MainViewApp` `useState`.
- Extending the existing `uiStore` / `useChannelPreferences` patterns. No new
  state library.

**Out of scope (flagged, not decided):**

- Purely-local component state (dialog toggles, picker popovers, transient form
  state) that is not a performance problem. These stay as `useState`;
  migrating them is ergonomics-only and optional.
- Replacing or further investing in the legacy `MessageTimeline.tsx`.
- WebRTC call state (`CallContext`) — separate subsystem, low jank impact.

## Proposed architecture (post-migration, targeted slices only)

Extend the existing pattern rather than invent a new one.

- `state/uiStore.ts` — keep as-is (UI flags). Already correct.
- `state/dataStore.ts` (new) — a `proxy` holding per-channel renderer data:
  `postsByChannel`, `users`, `userImages`, `userStatuses`, `userColors`,
  `typingUsersByChannel`. Mutations go through a `dataActions` object mirroring
  the `uiActions` style. This is the store that lets the timeline subscribe
  narrowly.
- `state/chatWorkspaceStore.ts` (new, optional Phase 3) — lift the tab/workspace
  `useReducer` state out of `ChatWorkspace.tsx` into a `proxy`, reusing the
  pure functions in `chatWorkspace.ts` as reducers/validators. Removes a large
  prop-drilling surface and stabilizes tab identity.

**Subscription discipline:** the timeline reads
`useSnapshot(dataStore).postsByChannel[channelId]` with a stable selector;
individual `MuiMessageItem`s read only their own post so an unrelated field
change does not re-render them. `renderItem` stops depending on a rebuilt
`messageById` (keyed store lookup instead).

Components that do not benefit from shared reactivity stay on `useState`. The
goal is *fewer* hooks in the right places, not "zero `useState`."

## Phased plan

### Phase 0 — Baseline & instrumentation (no feature code changes)

- Pick a representative heavy channel (long history, mixed media, active
  typing).
- Capture: React Profiler "record while scrolling/sending", Chrome Performance
  trace on a new-message burst, and `console.time` around
  `buildMuiTimelineMessages` and the markdown render path.
- Record concrete numbers: commit time per new message, % time in
  `ReactMarkdown`, count of `MuiMessageItem` commits per incoming message.
  This is the yardstick for every later phase.

### Phase 1 — Cheap, high-confidence fixes (no migration)

- **Markdown cache:** memoize parsed markdown output keyed by
  `(markdown, currentUsername)` so visible rows never re-parse on unrelated
  re-renders. Largest expected win.
- **Stabilize `renderItem`:** remove its dependency on the rebuilt
  `messageById` / `messageIds` (use keyed store lookups); preserve
  `getStableMessageIds` identity stability.
  - **STATUS (2026-08-11):** Implemented as two changes that deliver the
    re-render reduction the bullet was after.
    1. `buildTimelineRows` (`timeline.ts`) is now memoized by the posts array
       reference, so rows and reply arrays keep identity across rebuilds that
       don't change posts (avatar/presence loads). `+ __resetTimelineRowsCache`
       test hook.
    2. `buildMuiTimelineMessages` (`muiChatModels.ts`) now reuses per-message
       `ChatMessage` objects via a module cache keyed by post id, invalidated
       on any referential change to the post, its replies (compared by content
       so post bursts don't defeat it), the author user, avatar, status, or
       color. Channel change clears it; size capped at 1000. This is what makes
       `MuiMessageItem`'s `memo` bail out. `+ __resetMuiMessageCache` test hook.
       Verified by 5 cache unit tests + full suite (220 pass).
    - **Part 3 (stabilize `renderItem` *identity* via refs) deliberately
      skipped:** Part 2 already lets `MuiMessageItem` memo bail regardless of
      `renderItem` identity, so the win is achieved without the ref pattern.
      Stabilizing `renderItem` identity could let `MessageList` skip
      re-invoking it, but only if `MessageList` memoizes by `(id, renderItem)`
      internally — unverified without reading MUI X Chat source, and the
      staleness risk (changed message not refreshing) isn't worth the marginal
      gain. Revisit only if re-measurement shows `MessageList` bookkeeping as a
      remaining cost.
- **Scroll churn:** collapse the double `scrollToBottom` + RAF +
  `setLoadMoreReadyChannelId` into a single deterministic scroll, gated so it
  does not fight `autoScroll`.
- **Virtualization tuning:** validate `estimatedItemSize` against real heights;
  verify dynamic measurement for variable-height items.
- Re-measure after each.

### Phase 2 — Selective Valtio migration (only if Phase 0/1 data points at re-render scope)

- Introduce `dataStore.ts`; move `MainViewApp`'s posts/users/images/statuses/
  typing into it behind `dataActions`.
- Rewire `MainViewApp → ChatWorkspace → MuiMessageTimeline` to read from
  `useSnapshot` with narrow selectors instead of props.
- Re-measure: confirm the "incoming message → N rows commit" count drops.

### Phase 3 — (Optional) workspace store

- Move `ChatWorkspace` tab/layout state into `chatWorkspaceStore.ts` only if
  Phase 0 shows tab churn contributing to re-renders.

### Phase 4 — Consolidation & docs

- Update the React performance guidance in `CLAUDE.md` / `AGENTS.md` with the
  new store conventions.
- Leave a short ADR recording what was measured, what helped, and what did
  **not** (so the next "why is it janky" question has an answer).

## Success criteria

- **Measurable:** new-message commit time and per-event committed-row count
  both reduced vs. the Phase 0 baseline, with before/after numbers recorded.
- **Subjective:** scrolling a 500+ message channel and receiving a burst of
  messages feels comparable in smoothness to the official client on the same
  machine.
- **No regressions** in the existing component tests
  (`MuiMessageTimeline.test.tsx`, `ChatShell.test.tsx`, `ChatWorkspace.test.ts`).

## Risks & mitigations

- **Valtio + `useSnapshot` footguns:** reading a snapshot outside
  `useSnapshot` returns a non-reactive proxy; mutating during render throws.
  *Mitigation:* all writes go through `*Actions` objects (matching
  `uiActions`), plus a test asserting store reads go through `useSnapshot`.
- **Migrating while the legacy timeline still exists:** scope Phases 1–2 to the
  MUI timeline only; leave the legacy path untouched to limit blast radius.
- **Over-migration:** resist moving form/transient state into the store "for
  consistency." Each migrated slice needs a reason (perf or a concrete
  ergonomics win).
- **Measurement noise:** capture multiple runs; test on a representative
  channel, not an empty one.

## Testing considerations

- Keep the existing server-render test harness for the timeline; follow the
  project's `@tanstack/react-virtual` SSR test skill for any new virtualization
  tests.
- Add a focused test asserting `renderItem` identity is stable across an
  unrelated store update (the core re-render-scope guarantee).
- Performance is verified by traces, not unit tests — Phase 0 and
  re-measurements are the "test."

## Appendix: Phase 0 profiling runbook

Lightweight instrumentation was added in `src/mainview/utils/perfTrace.ts` and
wired into the four hot paths. It is **off by default** and costs nothing in
production (a single boolean check per call). Enable it in the running app:

```js
localStorage.setItem("mm-clone:perf", "1");
// reload the window
```

### What gets logged (to console.debug, filterable in DevTools)

- `[perf] buildMuiTimelineMessages: <ms>ms` — every rebuild of the timeline
  message list. Spikes here on a single incoming message indicate the whole
  list is being rebuilt (Phase 2 target).
- `[perf] render counts: { MattermostTextPart: N, MuiMessageItem: N, MarkdownRenderer: N }`
  — flushed every ~1.5 s. **N for `MattermostTextPart`/`MuiMessageItem` per
  incoming message is the key baseline number.** If N ≈ visible rows on each
  new message, re-render scope is confirmed (Phase 1b/2 target).

### Capture sequence (record numbers into this ADR before Phase 1)

1. Pick a heavy channel (200+ messages, some images/code blocks, active
   typing).
2. **Scenario A — initial load:** open the channel. Note the
   `buildMuiTimelineMessages` time and the first flush's render counts.
3. **Scenario B — burst:** receive ~10 rapid messages. Note the
   `buildMuiTimelineMessages` count/time during the burst and the per-burst
   render counts (how many `MattermostTextPart`s committed per incoming
   message).
4. **Scenario C — scroll-up load-more:** scroll to top to trigger history
   load. Note timing and any scroll jump.
5. Also record a **React Profiler** session (DevTools → Profiler → Record)
   for Scenario B, and a **Performance** trace (Main thread flame chart) for
   one incoming message. The Profiler gives commit time per message; the
   flame chart shows time inside markdown parsing vs. layout.

Record the numbers here before starting Phase 1:

```
Scenario A (initial load) — RECORDED 2026-08-11:
  buildMuiTimelineMessages: called 9 times during startup
    per-call ms: 10, 1, 0, 1, 0, 0, 1, 1, 0  (~14ms total, 10ms peak first call)
  startup render counts (3 flushes, ~4.5s):
    MuiMessageItem:        420 + 120 + 60 = 600 total
    MattermostTextPart:    720 + 240 + 120 = 1080 total
    MarkdownRenderer:      720 + 240 + 120 = 1080 total  (1:1 with text parts)
  message count in channel: ~60 (inferred from 60-item steady-state flush)
  => ~10 item renders / message, and ~18 markdown parses / message, during startup
  observed defect: channel opens a few messages ABOVE the bottom (scroll-to-bottom
    does not land at the true bottom) — confirms Phase 1d scroll churn

  AFTER Phase 1a (markdown memo) — RE-MEASURED 2026-08-11:
    buildMuiTimelineMessages: ~13 calls, per-call 0-2ms (10ms first), ~18ms total
    steady-state flush: {MuiMessageItem: 58, MattermostTextPart: 116}
    MarkdownRenderer: ABSENT from counts (memo bails out before markRender fires)
    => markdown parse cost eliminated on re-render (~18x reduction confirmed).
       Remaining MuiMessageItem/MattermostTextPart re-renders are cheap (children
       cached); their root cause is now re-render scope on avatar/presence loads
       (Phase 1c structural memoization / Phase 2 Valtio).

  AFTER Phase 1c (per-message object cache) — RE-MEASURED 2026-08-11:
    buildMuiTimelineMessages: ~11 calls during startup (10ms first cold parse,
      0-1ms thereafter) — cache hits make rebuilds near-free
    steady-state flush: {MuiMessageItem: 58, MattermostTextPart: 61}
    => MattermostTextPart 116 → 61 (~1:1 with the ~58 visible items) confirms
       the per-message cache returns stable `part` references, so
       MattermostTextPart's memo bails on re-render. MuiMessageItem at 58 is at
       the initial-mount floor (every visible item renders exactly once).
    => Over-render resolved: ~10-18x → ~1x. Remaining startup cost is the
       unavoidable initial mount + first cold markdown parse (10ms).
    => Phase 2 (Valtio) urgency REDUCED: Phase 1c's per-message cache already
       delivers narrow per-user revalidation — one avatar load now invalidates
       only that user's message objects, which is the re-render-scope fix
       Phase 2 was meant to provide. Recommend holding Phase 2 unless a live
       burst (Scenario B) shows residual over-render.
    DEFERRED CONFIRMATION: Scenario B (10-msg burst in an already-loaded
       channel) is the one test that distinguishes "memo bails on live updates"
       from "only bails on startup." If a burst shows MuiMessageItem ≈ N (not
       58×N), Phase 1c is fully confirmed.

Diagnosis confirmed by Scenario A (startup is itself a message burst as posts,
avatars, and presence stream in):
  - Re-render scope is real and severe: ~10x over-render per message.
  - Markdown re-parse is the dominant per-render cost: 1080 fresh parses for ~60
    unique message texts => the Phase 1a cache targets a ~18x reduction.
  - The list rebuilds 9 times during startup (posts arriving in chunks + avatar
    loads + presence updates each invalidate the `messages` useMemo). Each
    rebuild produces fresh message objects, breaking memoization and cascading
    to a full re-render of every visible item. This is the Phase 1b/1c/2 target.
  - The Phase 2 (Valtio) migration is now justified: narrow per-user / per-post
    subscriptions would turn "one avatar loads => 600 re-renders" into "one
    avatar loads => that user's rows re-render".

Scenario B (10-message burst):
  buildMuiTimelineMessages calls: ____  total ms: ____
  MattermostTextPart commits / incoming msg: ____
  MuiMessageItem commits / incoming msg: ____

Scenario C (load-more):
  buildMuiTimelineMessages ms: ____  scroll jump observed: y/n
```

### Turning it off

```js
localStorage.removeItem("mm-clone:perf");
// reload
```

The instrumentation is intended to stay in-tree (guarded) through Phase 2 so
each phase's re-measurement uses the identical yardstick.
