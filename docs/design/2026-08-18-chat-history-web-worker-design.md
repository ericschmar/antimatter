# Web worker chat-history loading + predictive prefetch — Design

- **Date:** 2026-08-18
- **Status:** Phase 1 implemented 2026-08-18 (worker, LRU cache, invalidation, priority queue). Phase 2 (§8 predictor) in progress.
- **Related skills:** `antimatter-chat-workspace-startup-loading`, `antimatter-mui-timeline-render-perf`, `antimatter-valtio-state-migration`
- **Related prior designs:** `2026-08-11-rendering-smoothness-and-selective-valtio-migration-design.md`, `2026-08-06-tabbed-chat-panes-design.md`

## 1. Problem statement

Chat histories are loaded on the main thread today. Every channel switch runs the same waterfall — posts → post users → channel members → member users — as awaited RPC round trips inside the webview (`loadChannelHistory`, `src/mainview/app/MainViewApp.tsx:105-130`), and restored split tabs each run their own copy at login (`MainViewApp.tsx:741-755`). Three user-facing symptoms:

1. **Slow channel switching** — clicking a channel shows a spinner while the waterfall completes.
2. **UI jank during loads** — typing, scrolling, and animations stutter while histories are in flight.
3. **Slow startup with restored tabs** — all restored panes load at once at launch and the app briefly freezes.

A later enhancement (Phase 2) adds predictive prefetch: guess the next channel the user will click and load it in the background so switching is instant.

## 2. Goals and non-goals

**Goals**

- Move history orchestration/normalization off the main thread into a dedicated web worker.
- A worker-side history cache so returning to a recently loaded channel is instant.
- Prioritized, parallel loading of restored tabs at startup.
- Protocol/cache seams designed so Phase 2 prediction plugs in without redesign.

**Non-goals (Phase 1)**

- Scroll-back pagination (`getPostsForChannelBefore`) stays on the main thread.
- Reactions fetch loop and websocket handling stay as-is.
- React render/commit work — the existing memoization work (`buildTimelineRows` caches, per-message object cache) remains the tool for that; a worker cannot commit React.

## 3. Approaches considered

- **A. Worker as data pipeline + cache (chosen).** The worker owns orchestration, normalization, and caching; a thin main-thread broker relays raw `mattermostRequest` calls for it; SWR stays the React-facing source of truth with its fetcher delegating to the worker. Wins on all three symptoms with one mechanism. Cost: a message protocol and a bundling spike.
- **B. Composite RPC in bun.** One bun-side call performs the whole waterfall server-side in parallel. Fastest wall-clock, zero worker risk — but moves logic bun-ward and provides no home for a prefetch cache or future prediction. Kept as fallback if A's bundling spike fails.
- **C. Worker renders rows too.** Also move `buildTimelineRows`/`buildMuiTimelineMessages` into the worker. Biggest jank win, but those are entangled with React render memoization and image space reservation; high regression risk for modest gain beyond existing memoization. Deferred; the protocol does not preclude it.

## 4. Architecture

### 4.1 Components

- `src/mainview/workers/chatHistoryWorker.ts` — worker entry: request orchestrator, normalizer, LRU cache, priority queue, (Phase 2) predictor. Pure logic, no DOM, no Valtio, no token.
- `src/mainview/workers/chatHistoryClient.ts` — main-thread client: typed `request()/onMessage()` wrapper, lazy worker creation, fallback to the existing `loadChannelHistory` if worker creation fails.
- `src/mainview/workers/rpcBroker.ts` — the relay. Worker asks for an API path; broker injects `serverUrl`/`token`, calls the existing electrobun RPC (`mattermostRequest`), returns the body. **The token never enters the worker.**
- `MainViewApp.tsx` — the single `useSWR` fetcher for `channel-history` keys (`MainViewApp.tsx:431-435`) swaps from `loadChannelHistory(api, ...)` to `chatHistoryClient.load(serverUrl, channelId)`. Everything downstream (`applyChannelHistory`, Valtio commits, reactions effect at `MainViewApp.tsx:614+`) is untouched.

### 4.2 Data flow for a channel click

1. SWR fires with key `["channel-history", serverUrl, channelId]` → fetcher posts `loadHistory` to the worker (or resolves instantly from worker cache when warm).
2. Worker runs the existing waterfall logic — same request sequence, but the awaits and response processing live off the main thread; posts/members fetches it can already parallelize get parallelized.
3. Broker relays each hop; worker normalizes into the same `ChannelHistoryData` shape (`src/mainview/types.ts:144`), including a `hasMore` flag that today's `setChannelHasMoreHistory` side-effect needs.
4. One `postMessage` delivers the finished payload; SWR resolves; the current commit path runs unchanged.

### 4.3 Startup with restored tabs

The worker accepts a priority queue: active tab's channel first, then the others concurrently (bounded at 2 concurrent waterfalls), so restored panes fill without serializing four-round-trip waterfalls per pane.

### 4.4 Worker lifecycle

Created lazily after login/`status === "ready"` with a known server; terminated and cache-dropped on logout or server switch. Never instantiated during SSR/tests (guarded so the existing react-dom/server test pattern keeps working).

## 5. Worker protocol and broker

**Messages, main → worker**

- `{ kind: "loadHistory", requestId, serverUrl, channelId, currentUserId, priority: "user" | "startup" | "prefetch" }`
- `{ kind: "invalidate", entries: [{ serverUrl, channelId }] }`
- Phase 2: `{ kind: "recordVisit", serverUrl, channelId, at }`, `{ kind: "updateSignals", signals }`

**Messages, worker → main**

- `{ kind: "historyLoaded", requestId, serverUrl, channelId, data, hasMore }`
- `{ kind: "historyError", requestId, message, status? }`
- `{ kind: "rpcCall", requestId, path, method?, body?, responseType? }` — the relay hop

**Relay with credential injection.** The worker constructs its own `MattermostApiClient` with a postMessage-based `MattermostTransport` — the injectable-transport seam already exists (`MattermostTransport`, `src/mainview/mattermostApi.ts:31-33`), so `getPostsForChannel`, `getPostUsers`, `getChannelMembers`, `getUsersForIds` move into the worker unchanged. The worker's transport strips `serverUrl`/`token` before posting; the main-thread broker re-injects them from its own client config and calls the existing electrobun RPC. Token stays out of the worker; bun-side code is untouched.

**`hasMore` side-effect.** Today `loadChannelHistory` calls `chatDataActions.setChannelHasMoreHistory` mid-flight (`MainViewApp.tsx:111`). In the worker that becomes a payload field; the main-thread client wrapper calls `setChannelHasMoreHistory` when the promise resolves — same semantics, one call site covering both the SWR fetcher and the startup path.

**Queue.** Priority queue (user > startup > prefetch), in-flight dedupe per channel, max 2 concurrent waterfalls so a burst of tab restores can't starve the selected channel.

## 6. Error handling

- **Worker creation fails or protocol times out** (5s handshake): client sets `available = false`; all loads fall through to the existing main-thread `loadChannelHistory`. Feature degrades to today's behavior, never to a blank timeline.
- **RPC failure mid-waterfall**: worker replies `historyError`; client rejects with a reconstructed `MattermostApiError` (status preserved), so existing SWR error handling and toasts are unchanged.
- **Stale responses**: requestId matching; a resolved-but-unneeded load just lands in the worker cache (still valid data).
- **SSR/tests**: worker only constructed when `typeof Worker !== "undefined"` and `status === "ready"`.

## 7. Cache coherence

The worker cache is a prefetch/stale-while-revalidate store; SWR remains the rendered-data store. On a cache hit the fetcher returns the cached payload immediately for instant paint, then triggers a background revalidation to catch anything posted since. The main thread already sees every websocket post/reaction event — it forwards `{ kind: "invalidate" }` for cached channels, so a hit is never shown without a refresh check. LRU cap ~20 channels, TTL 10 minutes, dropped entirely on logout/server switch.

## 8. Phase 2: predictive prefetch (future enhancement)

**Signal sources** (all already in the webview):

- **Transition history** — first-order Markov table of `currentChannel → nextChannel` counts from actual clicks. Captures habits like town-square ↔ off-topic or "check DMs after standup." No visit history exists today (prev/next navigation is pure list adjacency, `ChatShell.tsx:318-321`), so Phase 2 builds its own visit log in the worker, fed by `{ kind: "recordVisit" }` from the same handler that sets `selectedChannelId`.
- **Mentions/unreads** — the strongest click magnet; `uiStore` channel notifications and channel `mention_count`/`unread_count` already exist.
- **Typing indicators** — someone typing in a channel predicts both a new message and a click to read it; the typing map already exists (`pruneExpiredTypingUsers`).
- **Time-of-day + recency** — EMA of per-channel visit times; decays toward channels visited at this hour on previous days.

**Scoring.** `score(c) = w₁·P(next|current) + w₂·unreadWeight(c) + w₃·typingActive(c) + w₄·timeOfDay(c)`. Fixed seeded weights in v1 (Markov and unread weighted highest). No ML, fully explainable, trivially tunable. Persistence to config is deferred until the in-memory version proves its hit rate.

**Scheduling.** After the startup queue drains and on each channel switch, the worker scores all un-cached channels and enqueues the top 2 as `priority: "prefetch"`. Constraints: max 1 prefetch in flight, ≥2s spacing, none while the websocket is reconnecting, none when the selected channel is still loading. Prefetched results raise `historyPrefetched` → main thread warms the SWR cache via `mutateSWR(key, data, { revalidate: false })` — the click lands on an already-populated cache and renders with zero fetches.

**Guardrails.** Prefetch only issues the same read-only GET waterfall; hard cap on total prefetched channels per hour; everything dropped on logout.

**Measurement.** Extend the existing `perfTrace` with `historyFetchStart/End`, `cacheHit`, `prefetchQueued/Loaded`, and a click→first-timeline-paint span. Success = prefetched-channel switch p95 under ~1 frame budget for the fetch leg (data already resident; only React commit remains) vs. today's 3-round-trip waterfall.

## 9. Testing and rollout

- **Unit (bun test)**: the worker's orchestrator, cache, queue, and predictor are pure modules with an injected fake transport — same pattern as `mattermostApi.test.ts`. The predictor gets deterministic tests (feed a click sequence, assert top-2 prefetch set).
- **Integration**: protocol round-trip against a fake `Worker` (postMessage-backed).
- **React/SSR tests**: unchanged, via the fallback guard.
- **Rollout**:
  1. (0) Electrobun bundling spike — verify a module worker builds and boots under `electrobun dev`/`build`. This gates the approach; blob-URL classic worker is fallback, composite-RPC-in-bun (approach B) is the escape hatch.
  2. (1) Protocol + client + broker; orchestration moved into worker behind the fallback; behavior-identical, no cache.
  3. (2) Cache + invalidation + startup priority ordering.
  4. (3) Phase 2 predictor behind the guardrails above.

## 10. Risks and honest caveats

- Since bun already performs the HTTP and responses arrive as parsed JSON, the worker's win is moving orchestration/normalization off the main thread plus giving prefetch a home — not raw network speed. The end-to-end win should still be large for startup and jank.
- Worker bundling under Electrobun's build pipeline is unproven until the spike lands; two fallbacks exist (blob-URL classic worker; composite RPC in bun).
- `MainViewApp.test.ts` asserts on source text (e.g. the `loadChannelHistory` call shape inside the SWR fetcher); those assertions must move with the fetcher change.
