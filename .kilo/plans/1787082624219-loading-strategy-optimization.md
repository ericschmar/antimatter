# Chat History Loading Strategy Optimization

**Goal**: Reduce time from channel click to interactive timeline by restructuring the critical path, eliminating redundant network calls, and deferring non-essential work.

**Status**: Ready for implementation

---

## Current Critical Path (2 serial rounds)

```
Round 1 (parallel):  getPostsForChannel + getChannelMembers
Round 2 (parallel):  getPostUsers + getUsersForIds(member users)
```

**Problems**:
1. `getChannelMembers` blocks the critical path — for large channels (100+ members), this is a slow, unnecessary fetch since the timeline doesn't render from members
2. Two separate `POST /users/ids` calls in round 2 — post authors and member users are fetched independently despite potential overlap
3. No cross-channel user cache — same users re-fetched on every channel switch
4. `loadPostReactions` fires unbounded concurrent requests (one per post) that compete with history/member fetches for the same network pipeline
5. Prefetch loads fetch members unnecessarily

---

## Optimized Critical Path (1 round)

```
Round 1:  getPostsForChannel only
Round 2:  getPostUsers (post authors only)
→ Return timeline data immediately (posts + postOrder + postUsers)
Background: getChannelMembers + memberUsers (non-blocking)
```

**Net effect**: 1 fewer round-trip on the critical path, and the remaining round-trip is smaller (no members payload).

---

## Implementation Plan

### Phase 1: Split waterfall — defer members off critical path

**Files**: `historyWaterfall.ts`, `chatHistoryProtocol.ts`, `workerCore.ts`, `chatHistoryClient.ts`, `MainViewApp.tsx`, `types.ts`

1. **Change `ChannelHistoryData`** (`types.ts:144-150`): Make `members` and `memberUsers` optional:
   ```ts
   export type ChannelHistoryData = {
     memberUsers?: MattermostUser[];
     members?: MattermostChannelMember[];
     postOrder: string[];
     posts: Record<string, MattermostPost>;
     postUsers: MattermostUser[];
   };
   ```

2. **Split `loadChannelHistoryWaterfall`** (`historyWaterfall.ts`):
   - Return `{ data: { postOrder, posts, postUsers }, hasMore }` after round 2 (posts + post users only)
   - Add a new exported function `loadChannelMembersWaterfall(api, channelId, currentUserId)` that fetches members + member users
   - Both functions return independently

3. **Update `HistoryWaterfallResult`** — no shape change needed, just the `data` field has optional members

4. **Update `workerCore.ts`**:
   - `startLoad` calls `loadChannelHistoryWaterfall` (fast path, no members)
   - After `respondLoaded`, fire `loadChannelMembersWaterfall` as a follow-up
   - When members arrive, send a new `historyMembersLoaded` message to main thread
   - Cache members separately in `historyCache` with a longer TTL (members change infrequently)

5. **Update `chatHistoryProtocol.ts`**: Add `historyMembersLoaded` message type carrying `{ channelId, members, memberUsers }`

6. **Update `chatHistoryClient.ts`**: Handle `historyMembersLoaded` → invoke a new `client.onChannelMembers` callback

7. **Update `MainViewApp.tsx`**:
   - Register `onChannelMembers` handler → calls `setChannelMembers(data.members)` and merges `memberUsers` into state
   - All existing `setChannelMembers(history.members)` call sites become no-ops or conditional on `history.members` being present
   - `applyChannelHistory` already handles missing `memberUsers` gracefully (spread of undefined → no-op)

8. **Update tests**: `historyWaterfall.test.ts`, `workerCore.test.ts`, `chatHistoryClient.test.ts`, `MainViewApp.test.ts`

### Phase 2: Cross-channel user cache in the worker

**Files**: new `userCache.ts`, `historyWaterfall.ts`, `chatHistoryWorker.ts`

1. **Create `src/mainview/workers/userCache.ts`**:
   - Simple `Map<string, { user: MattermostUser, expiresAt: number }>`
   - TTL: 10 minutes (configurable)
   - Methods: `get(id)`, `getMany(ids) → { cached: MattermostUser[], missing: string[] }`, `set(users)`, `clear()`
   - Max size: 500 entries (LRU eviction)

2. **Integrate into `historyWaterfall.ts`**:
   - Accept an optional `userCache` parameter
   - In `getPostUsers`: filter out user IDs already in cache before calling `getUsersByIds`, then cache the results
   - Same for `getUsersForIds` (member users path)
   - This reduces `POST /users/ids` payload size on subsequent channel switches

3. **Wire in `chatHistoryWorker.ts`**: Construct `userCache` instance, pass to waterfall

4. **Add tests**: `userCache.test.ts`

### Phase 3: Skip members for prefetch loads

**Files**: `workerCore.ts`, `historyWaterfall.ts`

1. **Add `skipMembers` option** to `loadChannelHistoryWaterfall`:
   ```ts
   export async function loadChannelHistoryWaterfall(
     api, channelId, currentUserId?, options?: { skipMembers?: boolean }
   )
   ```
   - When `skipMembers: true`, skip `getChannelMembers` entirely (already deferred in Phase 1, but also skip the background follow-up)

2. **In `workerCore.ts`**: When `isPrefetch` is true, pass `skipMembers: true` to the waterfall — prefetch only needs posts + post users for SWR warming

### Phase 4: Bounded reaction loading scheduler

**Files**: new `reactionScheduler.ts`, `MainViewApp.tsx`

1. **Create `src/mainview/utils/reactionScheduler.ts`**:
   - Per-channel cancellation: calling `scheduleForChannel(channelId, posts)` cancels any in-flight work for the previous channel
   - Per-post dedup: tracks a `Set<string>` of post IDs currently loading or already loaded
   - Concurrency cap: max 4 simultaneous `getReactionsForPost` calls
   - Batched state updates: collect resolved reactions and apply in a single `setState` call per batch (not per-post)
   - API:
     ```ts
     class ReactionScheduler {
       scheduleForChannel(channelId: string, posts: MattermostPost[], api: MattermostApiClient, onResolved: (postId: string, reactions: Reaction[]) => void): void;
       cancelChannel(channelId: string): void;
       reset(): void;
     }
     ```

2. **Replace `loadPostReactions`** in `MainViewApp.tsx`:
   - Instantiate `ReactionScheduler` at module level or in the component
   - All 7 call sites use `scheduler.scheduleForChannel(channelId, posts, api, (postId, reactions) => setState(s => setPostReactions(s, postId, reactions)))`
   - On channel switch / sign out: call `scheduler.cancelChannel(channelId)` / `scheduler.reset()`

3. **Add tests**: `reactionScheduler.test.ts`

### Phase 5: Merge user fetches within waterfall (minor)

**Files**: `historyWaterfall.ts`

After Phase 1, round 2 only has `getPostUsers`. The member user fetch moves to the background `loadChannelMembersWaterfall`. Within each function, there's only one `getUsersByIds` call, so no merge needed — the split itself eliminates the dual-fetch problem.

---

## Validation Plan

1. **Unit tests**: All new/modified modules get test coverage
   - `historyWaterfall.test.ts`: verify fast-path returns without members, background path returns members
   - `userCache.test.ts`: TTL expiry, LRU eviction, cache hit/miss
   - `reactionScheduler.test.ts`: cancellation, dedup, concurrency cap, batched updates
   - `workerCore.test.ts`: prefetch skips members, members follow-up message sent

2. **Integration checks**:
   - `bun test` — full suite passes
   - `bun run typecheck`
   - `bunx biome check` on all changed files
   - `bun run build`

3. **Manual verification**:
   - Channel switch: timeline renders before member avatar stack appears (verify with perf trace)
   - Prefetch: no `getChannelMembers` call in network tab for prefetch loads
   - Reaction loading: max 4 concurrent requests visible in network tab
   - User cache: second switch to same channel has fewer `POST /users/ids` calls

---

## Risk / Edge Cases

| Risk | Mitigation |
|------|-----------|
| Members arrive after user types @mention | Composer shows no suggestions until members load — acceptable per investigation (graceful empty) |
| ChannelHeader shows empty member stack briefly | Already tolerated in cached-history path; same transient behavior |
| User cache serves stale user profile | 10-min TTL is reasonable; user profile changes are rare and self-correct on next full fetch |
| Reaction scheduler delays reaction display | Reactions are additive UI — slight delay is acceptable; capped at 4 concurrent keeps UI responsive |
| Background member load fails silently | `loadChannelMembersWaterfall` already wraps in try/catch; members remain empty (graceful) |

---

## Out of Scope

- HTTP/2 multiplexing or connection pooling (transport-level, no code change needed)
- Virtualization of timeline (separate effort, no visible-range API exists today)
- Pagination/load-more optimization (stays on main thread per Phase 1 design doc)
- SWR cache layer changes (already well-optimized with stale-while-revalidate)
