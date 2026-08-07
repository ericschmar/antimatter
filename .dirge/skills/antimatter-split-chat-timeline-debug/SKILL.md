---
description: Debug and fix Antimatter split chat panels that render empty or incorrect timelines.
---

# Antimatter split chat timeline debugging

Use this when side-by-side chat panels, Dockview chat workspace tabs, or multiple chat timelines show empty/mismatched messages.

## Root-cause path to inspect

- `src/mainview/components/ChatWorkspace.tsx`
  - `ChatPanel` receives the shared `posts` prop from context.
  - Each panel filters with `post.channel_id === params.channelId` before rendering `MessageTimeline`.
  - Therefore the parent must pass posts for all loaded workspace channels, not only the active/selected channel.
- `src/mainview/app/ChatShell.tsx`
  - Single-chat fallback should receive the selected-channel `posts` array.
  - Workspace mode should receive a broader `workspacePosts` array.
- `src/mainview/app/MainViewApp.tsx`
  - `posts` derived from `state.postOrder` is selected-channel ordered timeline data.
  - `workspacePosts` should be derived from `Object.values(state.posts)` while excluding `custom_webrtc_call` posts.
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
