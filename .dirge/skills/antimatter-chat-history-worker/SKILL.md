---
name: antimatter-chat-history-worker
description: Design and implement moving Antimatter channel-history loading off the main thread into a web worker with an LRU cache, startup priority queue, and a future predict-and-prefetch phase. Covers the current SWR/waterfall loading architecture, the bun-brokered relay transport decision, and Electrobun/test constraints.
---

# Chat history web worker (Antimatter)

Status: Phase 1 implemented and green as of 2026-08-18 — design doc is `docs/design/2026-08-18-chat-history-web-worker-design.md` (canonical; do not duplicate). Worker + client + cache + load queue + invalidation + MainViewApp/SWR wiring all landed; `bun test` 309 pass, typecheck and biome clean, `electrobun build` produces the worker bundle. Remaining: runtime verification in WKWebView (blob fetch + handshake + fallback; bd issue antimatter-5t7), and Phase 2 predictor (not started).

## Implementation map (2026-08-18, Phase 1 landed)

- `chatHistoryProtocol.ts` — message types; `requestId 0` is the background-refresh sentinel (routed to `client.onBackgroundHistory`, never a pending load).
- `historyCache.ts` — LRU (20) + TTL (10 min); in tests inject `now` (`createHistoryCache({ now: () => 0 })`) or entries stored at `storedAt: 0` expire immediately under real `Date.now()`.
- `loadQueue.ts` — priority user > startup > prefetch, max 2 concurrent; drops a task whose channel is already running; replaces a queued task only when the new priority is higher.
- `historyWaterfall.ts` — shared by worker and main-thread fallback; round 1 = posts + members in parallel, round 2 = post users + member users in parallel; returns `{ data, hasMore }` with no side effects.
- `rpcRelay.ts` — worker-side MattermostTransport; `ok:false` WITH a `status` resolves (worker's MattermostApiClient then builds the MattermostApiError); a message-only result rejects (the RPC itself failed).
- `workerCore.ts` — cache hit answers instantly; entries older than 30s (staleAfterMs) serve then background-refresh; concurrent requests for one channel fan out from a single load.
- `chatHistoryWorker.ts` — IIFE entry; constructs its MattermostApiClient with placeholder credentials (the relay strips serverUrl/token before posting; the main thread re-injects).
- `chatHistoryClient.ts` — main-thread client; `createBlobWorker` fetches the IIFE bundle via its own views:// host and spawns a blob-URL classic worker; 5s handshake timeout retires the worker and falls back to the main-thread waterfall; module registry `setActiveChatHistoryClient` / `getActiveChatHistoryClient` / `invalidateActiveChatHistoryClient`.
- Wiring: `MainViewApp.tsx` `loadChannelHistory` routes through `getActiveChatHistoryClient()`, falling back to `loadChannelHistoryWaterfall`; client created at login (broker injects serverUrl/token main-side, `log` receives a `rendererLog("chat-history-worker", ...)` wrapper); `onBackgroundHistory` warms SWR via `mutateSWR(key, data, { revalidate: false })`; `setActiveChatHistoryClient(null)` on signOut; `useMainViewEvents.ts` `handlePost` calls `invalidateActiveChatHistoryClient(post.channel_id)`. `selectSearchPost` keeps its own inline thread-based load — intentionally not routed through the worker.

## Current-state map (post-Phase-1, 2026-08-18)

- `loadChannelHistory` in `src/mainview/app/MainViewApp.tsx` is now a thin wrapper: it calls `getActiveChatHistoryClient()?.loadChannelHistory(channelId, currentUserId)` when a session client is registered, else falls back to `loadChannelHistoryWaterfall` on the main thread. Either path then calls `chatDataActions.setChannelHasMoreHistory(channelId, hasMore)` and returns `data`.
- Module-level registry in `chatHistoryClient.ts`: `setActiveChatHistoryClient` (created per login in MainViewApp with a credential-injecting broker; reset to null in signOut), `getActiveChatHistoryClient`, `invalidateActiveChatHistoryClient` (called from `useMainViewEvents.handlePost` so websocket posts stale the worker cache).
- Worker side: `workerCore.ts` (cache + priority queue + per-channel request fan-out), `historyCache.ts` (LRU 20 / TTL 10 min; entries older than `staleAfterMs` 30 s answer immediately then trigger a requestId-0 background refresh → `client.onBackgroundHistory` → `mutateSWR(key, data, { revalidate: false })`), `historyWaterfall.ts` (posts+members in parallel, then postUsers+memberUsers in parallel — faster than the old serial waterfall).
- Pre-worker flow (historical, for diffing behavior): `loadChannelHistory(api, channelId, currentUserId)` in `src/mainview/app/MainViewApp.tsx` ran the load waterfall serially:
  1. `api.getPostsForChannel(channelId)` (page 0, 60/page) — also fires `chatDataActions.setChannelHasMoreHistory(channelId, Boolean(postList.prev_post_id))` as a side-effect
  2. `getPostUsers(...)` over post authors
  3. `getChannelMembers(...)` — independent of posts, parallelizable
  4. `getUsersForIds(...)` for member users
  - Returns `ChannelHistoryData { memberUsers, members, postOrder (order reversed), posts, postUsers }`
- Enrichment helpers live in `src/mainview/utils/mattermostLoaders.ts`.
- SWR wiring in `MainViewApp.tsx`: `channelHistoryKey()` → `["channel-history", serverUrl, channelId]`; `useSWR` fetcher calls `loadChannelHistory`; result is applied into the Valtio `chatDataStore` (commit path + reactions effect downstream).
- Transport: `MattermostApiClient` accepts an injected `MattermostTransport` (`src/mainview/mattermostApi.ts`); all HTTP is relayed to the bun process via the `mattermostRequest` RPC (`src/shared/electrobunRpc.ts`) with `serverUrl` + `token` on every request.
- `src/mainview/workers/` now contains the chat history worker (Phase 1). No other workers exist; `SharedWorker` is still unused.
- Scroll-back pagination uses `getPostsForChannelBefore` in `MainViewApp.tsx` (~line 1364).

## User decisions (approved direction)

- Symptoms to fix: ALL of channel-switch latency, UI jank during loads, and slow startup with restored tabs.
- Transport: **bun-brokered via main thread** — worker orchestrates and normalizes; a thin main-thread broker relays each request to the existing `mattermostRequest` RPC and returns the body. The auth token never enters the worker. Direct worker→Mattermost fetch (CORS + token exposure) and a composite bun-side RPC were rejected for Phase 1.
- Worker as data pipeline + cache: SWR stays the React-facing source of truth; its fetcher delegates to the worker client.

## Phase 1 design

Components:
- `src/mainview/workers/chatHistoryWorker.ts` — request orchestrator, normalizer, LRU cache, (Phase 2) predictor. Pure logic: no DOM, no Valtio, no token.
- `src/mainview/workers/chatHistoryClient.ts` — main-thread typed `request()`/`onMessage()` wrapper; lazy worker creation; fallback to the existing `loadChannelHistory` if worker creation fails.
- `src/mainview/workers/rpcBroker.ts` — relay: worker asks for an API path; broker injects `serverUrl`/`token`, calls `rpc.request("mattermostRequest", ...)`, returns the body.
- `MainViewApp.tsx` — swap the `channel-history` SWR fetcher from `loadChannelHistory(...)` to `chatHistoryClient.load(...)`; everything downstream (Valtio commits, reactions effect) unchanged.

Behavior:
- One `postMessage` returns the finished `ChannelHistoryData` payload, including a `hasMore` flag so the `setChannelHasMoreHistory` side-effect can be driven from the worker result.
- Startup: priority queue — active tab's channel first, then restored tabs concurrently (bounded) so restored panes don't serialize four-round-trip waterfalls.
- Lifecycle: worker created lazily after login / `status === "ready"` with a known server; terminated and cache-dropped on logout or server switch; NEVER instantiated during SSR/tests.
- Parallelize the members fetch (it doesn't depend on posts).

Out of scope for Phase 1: scroll-back pagination (`getPostsForChannelBefore`), reactions fetch loop, websocket handling, React render/commit work (existing memoization remains the tool there).

## Phase 2 (future enhancement)

Predict the next chat that will be clicked and prefetch it through the same worker cache so the click is instant. Phase 1's message protocol and cache must be designed so the predictor plugs in without redesign.

## Pitfalls / open risks

- RESOLVED (spike outcome): `new Worker(new URL(...))` module workers do NOT work under Electrobun/Bun.build. Working approach: a build-only IIFE "view" entry in `electrobun.config.ts` (`chatHistoryWorker` view) — `electrobun build` emits `views/chatHistoryWorker/chatHistoryWorker.js`; the main thread fetches it via `${location.protocol}//chatHistoryWorker/chatHistoryWorker.js` and spawns a blob-URL classic worker (`createBlobWorker` in `chatHistoryClient.ts`). A path-relative URL resolves under the mainview host and 404s — the worker is addressed as its own "host".
- Tests render with react-dom/server; guard worker creation the same way @tanstack/react-virtual is handled (see the antimatter-virtualized-react-ssr-tests skill).
- NEVER import `../app/rpc` (or anything transitively pulling `electrobun/view`) from `src/mainview/workers/*` — it throws at module load under `bun test` outside a real webview ("Unhandled error between tests" with no per-test failure). Diagnostics logging must be injected: `createChatHistoryClient({ log })` receives a `rendererLog("chat-history-worker", ...)` wrapper from MainViewApp; the default is console.log.
- `createHistoryCache` tests must inject `now: () => 0` — the default `Date.now()` makes TTL/expiry assertions nondeterministic.
- `MainViewApp.test.ts` and `useMainViewEvents.test.ts` assert on source text (`readFileSync` + `toContain` of exact code snippets inside `loadChannelHistory`/`handlePost`); changing those function bodies requires updating the embedded string assertions too.
- Do NOT move `buildTimelineRows`/`buildMuiTimelineMessages` into the worker — they're entangled with React render memoization and image space reservation; high regression risk for modest gain.
- `electrobun.config.ts` has a `build.copy` map for static assets if the worker ends up needing a separate unbundled entry file.

## Verification

bun test && bun run typecheck
