---
description: Implement Mattermost message deletion in Antimatter across API, websocket normalization, timeline rendering, context menu RPC, and renderer state updates.
---

# Mattermost Message Deletion

Use this when adding or revisiting delete behavior for Mattermost posts in Antimatter.

## Expected behavior

- `MattermostPost.delete_at > 0` is the deleted-message marker.
- Deleted posts remain in state and render as literal `(deleted)`.
- Deleted posts/replies must not show stale message markdown, attachments, reactions, reply controls, reaction controls, or message context-menu actions.
- Mattermost remains the authorization boundary for REST deletion; renderer gating is only UI/optimistic behavior.

## Implementation points

- API client: add/use `MattermostApiClient.deletePost(postId)` with `DELETE /posts/${encodeURIComponent(postId)}`.
- Websocket normalization: treat Mattermost `posted`, `post_edited`, and `post_deleted` events with `data.post` as the normalized `{ type: "post", post, teamId }` event.
- Timeline rendering: check `post.delete_at > 0` in both `MessageRow` and `ReplyMessage`; render `(deleted)` and suppress attachments, reactions, reply button, and add-reaction popover.
- Timeline memo comparator: include `delete_at` for top-level posts and replies or delete websocket updates can be ignored by memoized rows.
- Context menu RPC: extend `MessageContextMenuRequest` with `canDelete` and `MessageContextMenuAction` with `"delete"`; update both Bun and renderer callers together.
- Bun menu: add a Delete menu item enabled from `canDelete`; include `"delete"` in context-menu action validation.
- Renderer menu request: gate delete with `post.user_id === currentUser?.id && !post.pending && post.delete_at === 0`; skip opening the message context menu for deleted posts.
- Renderer delete action: in `useMainViewEvents`, handle `"delete"` by optimistically replacing the post with `{ ...post, delete_at: Date.now(), update_at: Date.now() }`, calling `api.deletePost(post.id)`, and rolling back with `updatePost` plus `setError` on failure.
- Websocket post state updates: replace existing posts in normalized state/history when an incoming post ID already exists; otherwise append via the existing add path.

## Test coverage

- `src/mainview/mattermostApi.test.ts`: assert `deletePost` calls encoded `DELETE /posts/{id}`.
- `src/bun/mattermostWebSocketEvents.test.ts`: assert `post_edited` and `post_deleted` normalize as post events.
- `src/mainview/components/MessageTimeline.test.tsx`: assert deleted top-level posts and replies render `(deleted)`, hide stale content/attachments/reactions/controls, and memo comparison returns false when `delete_at` changes.

## Verification

Run:

```bash
bun test src/mainview/mattermostApi.test.ts src/bun/mattermostWebSocketEvents.test.ts src/mainview/components/MessageTimeline.test.tsx && bun test && bun run build
```

`bun run typecheck` should also be run separately, but it may fail only with pre-existing TS2882 CSS side-effect import declaration errors. Report that distinctly from feature regressions.