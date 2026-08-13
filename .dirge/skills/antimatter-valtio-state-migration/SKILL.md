---
name: antimatter-valtio-state-migration
description: Migrate prop-drilled/shared chat state in Antimatter into Valtio stores (the chatDataStore + chatWorkspaceStore pattern). Use when reducing prop drilling in the chat workspace/MUI timeline, or wiring/extending a Valtio store React components read at render time.
---

# Antimatter Valtio state migration

## When to use
- Reducing prop drilling in the chat workspace / MUI timeline by moving shared state into a Valtio store.
- Adding or extending a Valtio store that React components read at render time.
- Debugging the existing chatDataStore / chatWorkspaceStore read paths.

## The store pattern (mirror uiStore)
Every store follows `src/mainview/state/uiStore.ts`:
- `export type XState = { ... }`
- `export const initialState: XState = { ... }`
- `export const store = proxy<XState>({ ...initialState })`
- `export const actions = { setFoo(next) { store.foo = next; }, resetForSignOut() { Object.assign(store, initialState); } }`
- Components read via `useSnapshot(store)`; producers write via `actions.setFoo(...)`.
- Setter helpers accept `T | ((current: T) => T)` and resolve with a small `resolveUpdater` — matches the functional-updater style of `setChannelNotifications` in uiStore.

## The two chat stores (both complete)
1. **`state/chatDataStore.ts`** (chatDataStore + chatDataActions) — read-only lookup data (api, currentUserId/currentUser, users, channelsById, userColors, userImages, userStatuses, settings, resolveImageSrc). MIRROR adoption: MainViewApp pushes each value in via a `useEffect`; React state in MainViewApp/useUserPresence remains the producer. `chatDataActions` includes `resetForSignOut()`.
2. **`state/chatWorkspaceStore.ts`** (chatWorkspaceStore + chatWorkspaceActions) — OWNS chat workspace tabs/layout + per-channel `ChatViewState` (draft, reply, edit, composerHeight, scrollAnchor). `chatWorkspaceActions` wraps the pure fns in `state/chatWorkspace.ts` (openChatTab/closeChatTab/activateChatTab/updateChatViewState/updateChatWorkspaceLayout/removeInvalidChatTabs). OWNER adoption: MainViewApp reads `useSnapshot(chatWorkspaceStore).workspace`, hydrates from persisted config on mount (a `workspaceHydratedRef` guard runs once synchronously on first render, replacing the old lazy useState initializer), dispatches actions, and resets on signOut.

## Two ways to adopt a store
- **Mirror (low risk):** existing useState/useSWR hooks stay the source of truth; one `useEffect` per field pushes each value into the store. The store is the READ path only. Used for chatDataStore.
- **Owner (high blast radius):** the store BECOMES the source of truth; useState/useRef are removed and handlers mutate the store directly. Used for chatWorkspaceStore. Higher risk because persistence, no-op short-circuits, ref-sync, and signOut semantics all move with it. When migrating an owner, also rewrite any source-text assertions in `*.test.ts` that match the old useState-based code (MainViewApp.test.ts had ~10 such brittle assertions across handleActivateChatTab / handleCloseChatTab / openChatTab / setEditTargetId / chatViewStates useState / panelState reads).

## CRITICAL pitfall: stores must not import from storage
A store module is imported transitively by component tests. Those tests `mock.module("../storage", ...)` returning ONLY the specific storage fns they stub. If the store does `import { defaultSettings } from "../storage"`, the mock starves it and tests throw `SyntaxError: Export named 'defaultSettings' not found in module '.../storage.ts'`. Fix: keep a LOCAL placeholder object for initial store state; the real value is mirrored in by the producer before any component renders. `chatDataStore` uses a local `placeholderSettings`.

## Mutual exclusion of edit/reply targets
At the action layer edit and reply targets are mutually exclusive: `setEditTarget(viewId, postId)` also nulls `replyTargetId`, and `setReplyTarget(viewId, postId)` also nulls `editTargetId`. Mirror this when adding new per-view target fields so `startReply`/`setEditTargetId` don't fight each other.

## Component changes when adopting a store
- Drop the now-drilled lookup/workspace props from the component's Props type and all call sites.
- Read store data with `useSnapshot(store)` inside the component; build the context/provider value from the remaining props + snapshot.
- Settings/flags move under a `settings` group: consumers read `context.settings.showProfilePictures`, not `context.showProfilePictures`. Update EVERY consumer (MattermostPartRenderers, MuiTimelineReplies, MuiMessageTimeline) or typecheck fails.
- `MuiMessageTimelineProps` holds only per-instance data (posts, channel, channelId, loading, loadingHistory, typingUsers, on* callbacks); the full `MuiTimelineContextValue` adds the lookup fields sourced from chatDataStore.

## Testing components that read the store
- In a `beforeEach`, reset then seed the store via actions: `chatDataActions.resetForSignOut()` then `chatDataActions.setCurrentUser(...)`, `setUsers(...)`, `setSettings(...)`, `setResolveImageSrc(...)`, etc. For workspace/view-state tests, seed `chatWorkspaceActions` (e.g. `replaceWorkspace(...)` inside the test render helper, as ChatShell.test.tsx does).
- Split the test factory: `timelineProps()` builds the slimmed per-instance props (spread into JSX), `contextValue()` builds the full context (for pure-fn args like `buildMuiTimelineMessages` / `buildMuiUsers`).
- Watch `lint/style/noNonNullAssertion` — prefer `?? ""` over `!` on possibly-null store reads.
- Store actions normalize nulls, so assert `toBe(null)` not `toBe(undefined)`.

## Verification
`bun test` (full suite: 235 pass), `bun run typecheck`, `bun run build`, `bunx @biomejs/biome check .`. Store unit tests: `bun test src/mainview/state/chatDataStore.test.ts src/mainview/state/chatWorkspaceStore.test.ts`.