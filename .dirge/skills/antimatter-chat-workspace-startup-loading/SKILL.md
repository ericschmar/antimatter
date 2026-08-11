---
name: antimatter-chat-workspace-startup-loading
description: Diagnose and fix Antimatter chat workspace startup issues where restored split chat panels render without messages until activated.
---

# Antimatter Chat Workspace Startup Loading

Use this when restored split chat panels exist on startup but only the active panel has message history.

## Root cause pattern

- `ChatShell` renders `ChatWorkspace` with `workspacePosts`.
- In `MainViewApp`, `workspacePosts` is derived from `Object.values(state.posts)`.
- Startup `connect` may only call `loadChannelHistory` for `selectedChannel`, so inactive restored workspace tab channels never enter `state.posts`.
- `ChatShell` can correctly pass all loaded posts while still showing empty inactive panels if `MainViewApp` never loaded those channels.

## Fix pattern

- In `MainViewApp.connect`, after channels are loaded and `selectedChannel` is known:
  - collect `Object.values(chatWorkspaceRef.current.tabs).map((tab) => tab.channelId)`;
  - filter to channel IDs present in the current channel list;
  - add `selectedChannel.id` so single-panel fallback remains loaded;
  - `Promise.all` `loadChannelHistory(nextApi, channelId, user.id)` for every ID;
  - `mutateSWR(channelHistoryKey(serverUrl, channelId), history, { revalidate: false })` for each loaded history;
  - merge all `history.posts` into the initial global `posts` object;
  - keep `postOrder` and `channelMembers` from the selected channel history only, because the non-workspace timeline still expects selected-channel ordering.

## Verification

- Add or update a `MainViewApp.test.ts` source-level regression matching existing tests:
  - checks for collection of `chatWorkspaceRef.current.tabs` channel IDs;
  - checks selected channel is added;
  - checks all restored IDs are loaded via `Promise.all`;
  - checks all histories are merged into `posts`.
- Run focused checks:
  - `bun test src/mainview/app/MainViewApp.test.ts src/mainview/app/ChatShell.test.tsx src/mainview/components/mui-headless-timeline/MuiMessageTimeline.test.tsx`
  - `bunx @biomejs/biome check src/mainview/app/MainViewApp.tsx src/mainview/app/MainViewApp.test.ts src/mainview/components/mui-headless-timeline/MuiMessageTimeline.css`
