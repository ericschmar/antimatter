---
name: antimatter-chat-workspace-startup-loading
description: Diagnose and fix Antimatter chat workspace content issues — restored split panels that render without messages on startup, chat tabs opened at runtime that render without prior messages or with a wrong header, and the empty select-a-conversation screen shown when the last tab closes.
---

# Antimatter Chat Workspace Content Loading

## 1. Startup: restored split panels render without messages

Use this when restored split chat panels exist on startup but only the active panel has message history.

Root cause:
- `ChatShell` renders `ChatWorkspace` with `workspacePosts`.
- In `MainViewApp`, `workspacePosts` is derived from `Object.values(state.posts)`.
- Startup `connect` may only call `loadChannelHistory` for `selectedChannel`, so inactive restored workspace tab channels never enter `state.posts`.

Fix pattern (in `MainViewApp.connect`, after channels are loaded and `selectedChannel` is known):
- collect `Object.values(chatWorkspaceRef.current.tabs).map((tab) => tab.channelId)`;
- filter to channel IDs present in the current channel list;
- add `selectedChannel.id` so single-panel fallback remains loaded;
- `Promise.all` `loadChannelHistory(nextApi, channelId, user.id)` for every ID;
- `mutateSWR(channelHistoryKey(serverUrl, channelId), history, { revalidate: false })` for each loaded history;
- merge all `history.posts` into the initial global `posts` object;
- keep `postOrder` and `channelMembers` from the selected channel history only, because the non-workspace timeline still expects selected-channel ordering.

## 2. Runtime: chat tabs opened at runtime load no prior messages

Chat tabs opened at runtime (sidebar select, create-channel, create-DM all funnel through `selectChannel`) rendered with no prior messages (issues antimatter-qma for DMs, antimatter-zfr for new channels — same root cause).

- Opening a workspace tab makes `activeWorkspaceChannelId` set and `standaloneChannelId` become `null`.
- The standalone `useSWR` history fetch in `MainViewApp` is keyed on `standaloneChannelId`, so it never fires while a tab is active.
- `selectChannel` previously only applied a cached history from the SWR cache and fetched nothing on a miss, so an uncached channel loaded empty.

Fix in `selectChannel` (both paths, via a shared `applyFetchedHistory(history)` helper that seeds the SWR cache with `revalidate: false`, applies `applyChannelHistory`, `setChannelMembers`, `setStatus("ready")`, and fetches reactions only for posts lacking them):
- Cache miss: fetch (`await loadChannelHistory(api, channel.id, currentUser?.id)`) and apply.
- Cache hit: apply the cached history immediately for an instant render, then a background `loadChannelHistory(...).then(applyFetchedHistory).catch(() => undefined)` catch-up. Cached histories only receive posts that arrived while the channel was selected, so serving the cache alone left tabbed channels without newer messages (the workaround was closing all tabs so the channel rendered standalone, whose useSWR revalidates).
- `openChatPanel` (the split action) intentionally needs NO fetch — it only splits an already-loaded channel.

Related background-channel plumbing (same bug family):
- Websocket `posted` events for NON-selected channels must not be dropped: `mutateChannelHistory(post.channel_id, ...)` keeps that channel's history cache fresh (a no-op when the channel has no cached history — do NOT seed an empty cache, it would turn `selectChannel` into a stale cache hit), and `applyIncomingPost` (`utils/state.ts`) stores the post in `state.posts` WITHOUT appending to `postOrder` (postOrder orders the standalone timeline of the selected channel only). `applyIncomingPost` ignores channels with no loaded posts.
- `refreshAfterReconnect` must apply the selected channel's refreshed history to state (nothing reads the mutated SWR cache while a workspace tab is active) and refresh every `chatWorkspaceStore.workspace.tabs` channel, applying each with `applyChannelHistory(current, history, false)` — the third param keeps postOrder intact so a background channel cannot clobber the standalone ordering.

## 3. DM channel header shows user UUID instead of name

DM chat tabs showed the raw channel `name` (two user IDs joined by `__`) in the header instead of the other user's name (issue antimatter-p4i).

Root cause: `ChannelHeader` titled itself with `channel.display_name || channel.name`. DM channels ship an empty `display_name`, so it fell back to the raw `name`.

Fix: use `channelLabel(channel, users, currentUserId)` from `src/mainview/utils/format.ts` — the canonical DM display-name resolver already used by the sidebar, tab strip, and command menu. It resolves the other user via `directChannelOtherUserId` and `userLabel`.

## 4. Closing the last tab shows the empty select-a-conversation screen

Behavior (supersedes the earlier sync-the-closed-channel fix): closing the final workspace tab clears the standalone selection instead of re-showing the closed channel. In `MainViewApp.handleCloseChatTab`, capture `const closedTab = chatWorkspaceStore.workspace.tabs[tabId]` BEFORE calling `closeChatTab` (the tab record is gone afterwards); after `replaceWorkspace` + `persistChatWorkspaceTabs`, run `if (closedTab && !nextWorkspace.activeTabId) setSelectedChannelId(null);`.

With no selection and no renderable workspace tabs, `ChatShell` skips `ChannelHeader` and the `.chat-body` timeline/composer entirely and renders the `.chat-empty` section (`.chat-empty-image` dashed placeholder with the lucide `Image` icon, "Select a conversation" heading). Launch still restores the last channel from persisted `lastChannelId`; only closing the last tab empties the view.

Tests: `MainViewApp.test.ts` "syncs Dockview panel close events to chat workspace state" asserts the exact `handleCloseChatTab` source (update the snippet whenever the handler changes); `ChatShell.test.tsx` "renders an empty select-a-conversation screen when no channel is selected" covers the empty-screen markup via `renderChatShell(null, emptyWorkspace)`.

## Verification

- Source-level regression tests in `MainViewApp.test.ts` slice raw source substrings (including indentation) out of `MainViewApp.tsx` and assert exact matches. These break if the source is reformatted (e.g. biome `--write`); update the assertion strings to match the new formatting.
- `ChannelHeader.test.tsx` renders `ChannelHeader` with `renderToString`. SSR of `ChannelHeader` requires a full `CallManager` mock (it renders `CallButton`): provide `getState`, `getSession`, `getLocalStream`, `getRemoteStream`, `on`, `initiateCall`, `acceptCall`, `declineCall`, `hangup`, `setAudioMuted`, `setVideoEnabled`, `switchMicrophone`, `switchCamera` — same shape as `ChatShell.test.tsx`. A partial mock throws `callManager.getState is not a function`.
- Run focused checks:
  - `bun test src/mainview/app/MainViewApp.test.ts src/mainview/components/ChannelHeader.test.tsx src/mainview/app/ChatShell.test.tsx`
  - `bun run typecheck` (passes with 0 errors as of commit cb7e5b4)
  - `bunx @biomejs/biome check <changed files>`
