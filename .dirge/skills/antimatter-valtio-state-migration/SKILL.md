---
name: antimatter-valtio-state-migration
description: Migrate prop-drilled/shared chat state in Antimatter into Valtio stores (the chatDataStore + chatWorkspaceStore pattern). Use when reducing prop drilling in the chat workspace/MUI timeline, wiring a new Valtio store, or resuming the two-stage chat-state migration.
---

# Antimatter Valtio state migration

## When to use
- Reducing prop drilling in the chat workspace / MUI timeline by moving shared state into Valtio.
- Adding or extending a Valtio store that React components read at render time.
- Resuming the two-stage chat-state migration (Stage A done, Stage B pending).

## The store pattern (mirror uiStore)
Every store follows `src/mainview/state/uiStore.ts`:
- `export type XState = { ... }`
- `export const initialState: XState = { ... }`
- `export const store = proxy<XState>({ ...initialState })`
- `export const actions = { setFoo(next) { store.foo = next; }, resetForSignOut() { Object.assign(store, initialState); } }`
- Components read via `useSnapshot(store)`; producers write via `actions.setFoo(...)`.
- Setter helpers accept `T | ((current: T) => T)` and resolve with a small `resolveUpdater` — matches the functional-updater style of `setChannelNotifications` in uiStore.

## The two chat stores
1. **`state/chatDataStore.ts`** — read-only lookup data (api, currentUserId/currentUser, users, channelsById, userColors, userImages, userStatuses, settings, resolveImageSrc). ACTIVE read path as of Stage A. `chatDataActions` includes `resetForSignOut()`.
2. **`state/chatWorkspaceStore.ts`** — chat workspace tabs/layout + per-channel `ChatViewState` (draft, reply, edit, composerHeight, scrollAnchor). `chatWorkspaceActions` reuses the pure fns from `state/chatWorkspace.ts` (openChatTab, closeChatTab, activateChatTab, updateChatViewState, updateChatWorkspaceLayout, removeInvalidChatTabs). Created + unit-tested but NOT yet wired as owner (Stage B).

## Two ways to adopt a store
- **Mirror (Stage A — low risk):** the existing useState/useSWR hooks stay the source of truth; one `useEffect` per field pushes each value into the store. The store is the READ path only. Used for chatDataStore (MainViewApp mirrors api/users/channels/settings/colors/images/statuses/resolveImageSrc; useUserPresence owns the user-state useState and its output is mirrored in MainViewApp).
- **Owner (Stage B — high blast radius):** the store BECOMES the source of truth; useState/useSWR are removed and handlers mutate the store directly. Needed for chatWorkspaceStore. Higher risk because persistence, no-op short-circuits, ref-sync, and signOut semantics all move with it.

## CRITICAL pitfall: stores must not import from storage
A store module is imported transitively by component tests. Those tests `mock.module("../storage", ...)` returning ONLY the specific storage fns they stub. If the store does `import { defaultSettings } from "../storage"`, the mock starves it and tests throw `SyntaxError: Export named 'defaultSettings' not found in module '.../storage.ts'`. Fix: keep a LOCAL placeholder object for initial store state; the real value is mirrored in by the producer before any component renders. `chatDataStore` uses a local `placeholderSettings`.

## Component changes when adopting a store
- Drop the now-drilled lookup props from the component's Props type and all call sites.
- Read lookup data with `useSnapshot(store)` inside the component; build the context/provider value from props + snapshot.
- Settings/flags move under a `settings` group: consumers read `context.settings.showProfilePictures`, not `context.showProfilePictures`. Update EVERY consumer (MattermostPartRenderers, MuiTimelineReplies, MuiMessageTimeline) or typecheck fails.
- `MuiMessageTimelineProps` now holds only per-instance data (posts, channel, channelId, loading, loadingHistory, typingUsers, on* callbacks); the full `MuiTimelineContextValue` adds the lookup fields sourced from the store.

## Testing components that read the store
- In a `beforeEach`, reset then seed the store via actions: `chatDataActions.resetForSignOut()` then `chatDataActions.setCurrentUser(...)`, `setUsers(...)`, `setSettings(...)`, `setResolveImageSrc(...)`, etc.
- Split the test factory: `timelineProps()` builds the slimmed per-instance props (spread into JSX), `contextValue()` builds the full context (for pure-fn args like `buildMuiTimelineMessages` / `buildMuiUsers`).
- Watch `lint/style/noNonNullAssertion` — prefer `?? ""` over `!` on possibly-null store reads.

## Resume point: Stage B (chatWorkspaceStore ownership)
- Blocked Beads issue `drg-ba10`. Approved scope but high blast radius; get explicit user go-ahead first.
- Move `chatWorkspace` + `chatViewStates` useState out of MainViewApp; route handlers through `chatWorkspaceActions` (openTab/closeTab/activateTab/setLayout/updateView/...).
- Rewriting ~8 brittle source-text assertions in `src/mainview/app/MainViewApp.test.ts` (they match the current useState-based source) is part of the work.
- Coupling to handle: persistence (`persistChatWorkspaceTabs`, currently called alongside `setChatWorkspace`), the `chatWorkspaceRef` no-op short-circuit, `setSelectedChannelId`, and signOut (`chatWorkspaceActions.reset()`).

## Verification
`bun test src/mainview/state/chatDataStore.test.ts src/mainview/state/chatWorkspaceStore.test.ts`
