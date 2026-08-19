# Chat-history critical-path optimization — Design

- **Date:** 2026-08-18
- **Status:** Planned
- **Related design:** `2026-08-18-chat-history-web-worker-design.md`

## 1. Objective

Reduce the time from a channel click to an interactive message timeline. The timeline needs posts and their authors; channel membership, member profiles, and reactions are additive UI and must not compete with that critical path.

## 2. Current behavior and bottlenecks

`loadChannelHistoryWaterfall` (`src/mainview/workers/historyWaterfall.ts`) currently makes two awaited rounds:

```text
posts + channel members (parallel)
post-author profiles + member profiles (parallel)
```

This blocks the initial timeline on membership data that it does not use. It also has no worker-scoped profile cache, so channel switches repeatedly request the same users. Once history lands, `loadPostReactions` starts one unbounded request per post, which can saturate the shared HTTP/RPC path during channel navigation, reconnect, and startup.

## 3. Decisions

1. Preserve `ChannelHistoryData`'s required `members` and `memberUsers` arrays. The timeline response uses empty arrays instead of widening the type with optional fields.
2. Split the waterfall into a foreground timeline load and a deferred member hydration.
3. Add a worker-lifetime user-profile resolver with TTL, LRU eviction, in-flight deduplication, and microtask batching.
4. Never hydrate members for a predictive prefetch. If a prefetched channel is later selected, schedule its member hydration then.
5. Replace unbounded reaction fan-out with a bounded, cancellable, deduplicating scheduler. Reactions remain additive and load after the first timeline paint.
6. Preserve the current worker fallback: unavailable-worker loads use the same split waterfall on the main thread and share the session-scoped profile resolver where practical.

## 4. Target data flow

### Foreground channel selection

```text
channel click
  -> worker cache hit: return timeline snapshot immediately
  -> worker cache miss: posts -> post-author resolver -> historyLoaded
  -> main thread updates SWR and Valtio; timeline can paint
  -> worker queues member hydration at bounded background priority
  -> members -> member-profile resolver -> historyMembersLoaded
  -> main thread updates selected-channel members, global users, and SWR entry
  -> after first paint, reaction scheduler begins bounded fetches
```

The first `historyLoaded` payload is valid `ChannelHistoryData` with `members: []` and `memberUsers: []`. This keeps existing `applyChannelHistory` and all current type consumers safe. The later `historyMembersLoaded` payload fills the metadata without replacing posts or timeline order.

### Predictive prefetch

```text
prefetch -> posts -> post-author resolver -> historyPrefetched/SWR warm
```

No channel-members or member-profile request is issued. A later foreground selection of this cache entry queues member hydration if that cache entry has no fresh members.

## 5. Implementation tasks

### 5.1 Split the history waterfall

**Files:** `src/mainview/workers/historyWaterfall.ts`, `src/mainview/types.ts`, and tests.

1. Keep `ChannelHistoryData` unchanged.
2. Make `loadChannelHistoryWaterfall` the foreground/timeline operation: fetch posts, reverse `order`, resolve only post authors, and return a complete `ChannelHistoryData` with empty member arrays plus `hasMore`.
3. Add `loadChannelMembersWaterfall(api, channelId, currentUserId, userResolver)` returning `{ members, memberUsers }`.
4. Refactor the profile-loading helpers in `src/mainview/utils/mattermostLoaders.ts` behind a small resolver interface so both the post-author and member paths use the same cached/batched resolver while retaining the existing current-user exclusion and failure behavior.
5. Unit-test the two independent waterfalls: the foreground load must never call member endpoints; member hydration must fetch and resolve members independently; failures must yield the same graceful empty-member behavior as today.

### 5.2 Add user-profile resolver and cache

**Files:** add `src/mainview/workers/userProfileResolver.ts` and test; wire through `chatHistoryWorker.ts`, `workerCore.ts`, `chatHistoryClient.ts`, and the fallback path.

1. Own one resolver per authenticated worker/session; discard it on worker retirement, sign-out, or server change.
2. Store profiles by user ID in a 500-entry LRU with a 10-minute TTL.
3. For each resolve request, return fresh cached profiles, deduplicate missing IDs, and join existing in-flight IDs.
4. Batch unresolved IDs queued in the same microtask into one `POST /users/ids` call. Fan the response out to every waiting caller and cache successful profiles.
5. Do not cache failures as successful results; apply a short retry cooldown only if needed to avoid a tight failure loop.
6. Share the resolver with the main-thread fallback for the active session. The fallback must otherwise retain today's successful-history behavior.
7. Add tests for TTL expiry, LRU eviction, current-user filtering, concurrent overlap, one batched API call for same-turn requests, and error recovery.

### 5.3 Deliver deferred members safely

**Files:** `src/mainview/workers/chatHistoryProtocol.ts`, `workerCore.ts`, `historyCache.ts`, `chatHistoryClient.ts`, `src/mainview/app/MainViewApp.tsx`, and tests.

1. Add worker-to-main `historyMembersLoaded`:
   ```ts
   { kind: "historyMembersLoaded", channelId, members, memberUsers }
   ```
2. After a successful foreground timeline load, enqueue member hydration on a background lane with one concurrent task. User and startup timeline loads retain precedence; prefetch never enqueues this work.
3. Update the matching history-cache entry when hydration succeeds so later cache hits include members. Track member freshness separately from the timeline timestamp; use a 10-minute member TTL initially.
4. Coalesce member hydrations by channel. A cache hit with empty or expired members queues at most one hydrator. A failed hydration leaves the member timestamp unset so a later foreground selection may retry without continuously looping.
5. In `chatHistoryClient`, expose an `onChannelMembers` callback. The callback must receive the channel ID so `MainViewApp` can ignore member-list UI updates for a channel that is no longer selected.
6. In `MainViewApp`, merge `memberUsers` into normalized users for any received channel, update the SWR entry for that channel by replacing its member arrays, and call `setChannelMembers` only when the channel is still rendered. Do not replace posts or `postOrder` in this callback.
7. Existing initial history commits continue to set an empty member list while a fresh channel loads. `ChannelHeader` hides the avatar stack and mention completion returns no candidates until hydration completes; the timeline remains interactive.
8. Add protocol/client/core/App tests for message routing, channel-switch races, cache-hit hydration, stale-member refresh, prefetch omission, and retry after metadata failure.

### 5.4 Make reactions bounded and non-critical

**Files:** add `src/mainview/utils/reactionScheduler.ts` and test; update `src/mainview/app/MainViewApp.tsx` and affected tests.

1. Replace `loadPostReactions`' unbounded `Promise.all` with a session-scoped scheduler.
2. Give it a maximum of four concurrent reaction requests, a queued/in-flight post-ID set, and a channel/generation token. Ignore a completion whose channel generation is no longer relevant; an in-flight HTTP request need not be aborted to preserve correctness.
3. Coalesce requests for the same post from cached history and background revalidation. Do not requeue posts whose `metadata.reactions` is already present in state.
4. Queue channel-history reactions after `requestAnimationFrame` following the first timeline commit. Live websocket posts can enter immediately but still obey the four-request cap.
5. Batch reaction state writes that resolve in one microtask into one `setState` update; retain `setPostReactions` semantics and its no-op for posts no longer in state.
6. Reset the scheduler on sign-out/server switch; invalidate queued tasks when the active foreground channel changes. Startup/background tab work should be lower priority than the selected channel.
7. Test the concurrency cap, cached/revalidated deduplication, stale-generation discard, batch application, live-post scheduling, and reset behavior.

### 5.5 Instrument and measure

**Files:** `src/mainview/utils/perfTrace.ts`, worker/client/App call sites, and tests.

Add trace events or spans for:

- channel click to first timeline paint;
- posts response to `historyLoaded` delivery;
- profile resolver cache hit/miss and batch size;
- member hydration queued/completed/failed;
- reaction queue depth, request count, and completion.

Compare p50/p95 click-to-first-timeline-paint and requests per channel switch before/after. A successful prefetch should show no member endpoint request until the prefetched channel is actually selected.

## 6. Failure and cache-coherence rules

- A foreground posts or post-author failure remains a `historyError` and preserves existing SWR/fallback handling.
- Member and reaction failures are additive failures: do not blank the timeline or transition it to error. Leave the affected metadata absent and permit a later retry.
- Worker cache invalidation for incoming posts remains unchanged. Member data expires on its own TTL; explicit channel-membership events, if available in the existing websocket layer, should also invalidate that channel's member freshness.
- On sign-out, worker retirement, or server switch, discard history, member, user-profile, and reaction-scheduler state together.

## 7. Validation

1. Run focused unit tests for the waterfall, resolver, worker core/client/protocol, reaction scheduler, and state updates.
2. Run `bun test`, `bun run typecheck`, the project Biome check, and `bun run build`.
3. Manually verify:
   - an uncached channel paints posts before header-member avatars and mention suggestions arrive;
   - a prefetched channel makes no member request until selected;
   - returning to recently visited channels reduces `/users/ids` traffic;
   - no more than four reaction requests run concurrently;
   - switching away during member/reaction work never overwrites the newly selected channel's member list;
   - worker failure still loads history through the main-thread fallback.

## 8. Rollout order

1. Introduce and test the split timeline/member protocol while retaining required empty member arrays.
2. Add member-cache updates and foreground-only hydration.
3. Add the user-profile resolver and route both worker and fallback loaders through it.
4. Exclude members from prefetch and verify warm-cache selection schedules them correctly.
5. Add the bounded reaction scheduler and instrumentation.

## 9. Out of scope

- Scroll-back pagination remains on the main thread.
- Timeline virtualization and visible-row reaction prioritization require a separate timeline-range API.
- HTTP connection pooling/retry policy is transport-level work and is not part of this change.
