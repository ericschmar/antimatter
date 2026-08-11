---
description: Debug and fix Antimatter split chat panels that render empty or incorrect timelines.
---

# Antimatter split chat timeline debugging

Use this when side-by-side chat panels, Dockview chat workspace tabs, or multiple chat timelines show empty/mismatched messages.

## Root-cause path to inspect

- `src/mainview/components/ChatWorkspace.tsx`
  - `ChatPanel` receives the shared `posts` prop from context.
  - Each panel filters with `post.channel_id === params.channelId` before rendering `MessageTimeline`.
  - In split views, clicking a non-focused panel composer activates the Dockview panel and re-renders all `ChatPanel` instances. If `panelPosts` is rebuilt with a fresh `.filter()` result every render, the MUI headless timeline can receive a new `items`/posts reference even when that channel's messages did not change, which can reset scroll to the top. Use `getStablePanelPosts` from `src/mainview/components/chatWorkspacePanelPosts.ts` so a panel reuses its previous post array when the same channel post object sequence is unchanged; do not rely only on the parent `posts` array reference, because the parent may allocate a fresh array on unrelated renders.
  - The MUI headless timeline itself also needs stable list inputs on unrelated rerenders: preserve the `MessageList.Root items` ID array when message IDs are unchanged, move static `slotProps`/`autoScroll` objects out of render, and wrap `renderItem` in `useCallback`. Inline object/callback props can still churn MUI internals even after panel posts are stable.
  - Therefore the parent must pass posts for all loaded workspace channels, not only the active/selected channel.
- `src/mainview/app/ChatShell.tsx`
  - Single-chat fallback should receive the selected-channel `posts` array.
  - Workspace mode should receive a broader `workspacePosts` array.
- `src/mainview/app/MainViewApp.tsx`
  - `posts` derived from `state.postOrder` is selected-channel ordered timeline data.
  - `workspacePosts` should be derived from `Object.values(state.posts)` while excluding `custom_webrtc_call` posts.
  - For split-panel focus/scroll-to-top bugs, do not stop after stabilizing `panelPosts`/message ID arrays. If clicking a non-focused panel composer still jumps or reloads, inspect Dockview activation: `handleActivateChatTab` can mutate global `selectedChannelId`, which drives selected-channel SWR history loading, `resetForChannelChange`, status/loading effects, and global load-more behavior.
  - Panel activation should no-op when activating the already-active tab. Workspace-mode history loading should be keyed through a standalone/single-chat channel rather than the active workspace panel, so focusing a split pane does not run single-chat history apply/reset effects. Workspace load-more should be channel-scoped from the panel (`params.channelId`) and should not rewrite global `postOrder` for non-standalone panels.
- `src/mainview/utils/state.ts`
  - `applyChannelHistory` must not replace the entire normalized `state.posts` map with the currently loaded channel only.
  - It should replace posts for the loaded history channel(s), while preserving posts from other channels so existing split panels retain timelines.

## Verification

- Add or run a `ChatShell` test proving `ChatWorkspace` receives all workspace channel posts when `posts` contains only the selected channel.
- Add or run an `applyChannelHistory` reducer test proving posts from another channel survive a selected-channel history re-sync.
- Run:
  - `bun test src/mainview/utils/state.test.ts src/mainview/app/ChatShell.test.tsx`
  - `bunx @biomejs/biome check src/mainview/utils/state.ts src/mainview/utils/state.test.ts src/mainview/app/ChatShell.tsx src/mainview/app/ChatShell.test.tsx src/mainview/app/MainViewApp.tsx`
  - `git diff --check`
