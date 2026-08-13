---
description: Diagnose and fix Antimatter chat workspace content issues: restored split panels that render without messages on startup, and chat tabs opened at runtime (DM or new channel) that render without prior messages or with a wrong header.
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

Root cause:
- Opening a workspace tab makes `activeWorkspaceChannelId` set and `standaloneChannelId` become `null`.
- The standalone `useSWR` history fetch in `MainViewApp` is keyed on `standaloneChannelId`, so it never fires while a tab is active.
- `selectChannel` previously only applied a cached history from the SWR cache and fetched nothing on a miss, so an uncached channel loaded empty.

Fix in `selectChannel` (on a cache miss):
- `const fetchedHistory = cachedHistory ? cachedHistory : await loadChannelHistory(api, channel.id, currentUser?.id);`
- seed the SWR cache: `mutateSWR(channelHistoryKey(config.serverUrl, channel.id), fetchedHistory, { revalidate: false })`
- apply it via `applyChannelHistory`, then `setChannelMembers(fetchedHistory.members)`, `setStatus("ready")`, and `void loadPostReactions(api, Object.values(fetchedHistory.posts))`.
- `openChatPanel` (the split action) intentionally needs NO fetch — it only splits an already-loaded channel.

## 3. DM channel header shows user UUID instead of name

DM chat tabs showed the raw channel `name` (two user IDs joined by `__`) in the header instead of the other user's name (issue antimatter-p4i).

Root cause: `ChannelHeader` titled itself with `channel.display_name || channel.name`. DM channels ship an empty `display_name`, so it fell back to the raw `name`.

Fix: use `channelLabel(channel, users, currentUserId)` from `src/mainview/utils/format.ts` — the canonical DM display-name resolver already used by the sidebar, tab strip, and command menu. It resolves the other user via `directChannelOtherUserId` and `userLabel`.

## Verification

- Source-level regression tests in `MainViewApp.test.ts` slice raw source substrings (including indentation) out of `MainViewApp.tsx` and assert exact matches. These break if the source is reformatted (e.g. biome `--write`); update the assertion strings to match the new formatting.
- `ChannelHeader.test.tsx` renders `ChannelHeader` with `renderToString`. SSR of `ChannelHeader` requires a full `CallManager` mock (it renders `CallButton`): provide `getState`, `getSession`, `getLocalStream`, `getRemoteStream`, `on`, `initiateCall`, `acceptCall`, `declineCall`, `hangup`, `setAudioMuted`, `setVideoEnabled`, `switchMicrophone`, `switchCamera` — same shape as `ChatShell.test.tsx`. A partial mock throws `callManager.getState is not a function`.
- Run focused checks:
  - `bun test src/mainview/app/MainViewApp.test.ts src/mainview/components/ChannelHeader.test.tsx src/mainview/app/ChatShell.test.tsx`
  - `bun run typecheck` (passes with 0 errors as of commit cb7e5b4)
  - `bunx @biomejs/biome check <changed files>`