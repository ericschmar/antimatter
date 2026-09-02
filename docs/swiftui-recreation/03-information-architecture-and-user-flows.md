# Information Architecture and User Flows

## Window hierarchy

`MainWindow` contains native title/toolbar commands, then `WorkspaceShell`: resizable sidebar on the left and `ConversationWorkspace` on the right. The right side hosts either an empty state or a tab/split tree of independent conversation panes.

## Sidebar

Order is fixed:

1. Team header and account/status menu.
2. Horizontally scrolling team initials with unread dots.
3. Scrollable sections: Favorites, Channels, Direct Messages, Archived.
4. Active call strip only when the call phase is enabled.

Rows show channel emoji or `#`; DMs show a 20 pt avatar and presence dot. Unread rows gain weight; mentions add a 3 pt amber leading indicator and `!` badge. Double-click pins/opens a durable conversation tab. Hover exposes open-in-tab and favorite controls. Context menu includes channel emoji and archive actions. Section contents are collapsible and reorderable by drag/drop.

## Conversation pane

Every pane owns a channel ID and pane-local UI state. It contains:

- Header: label, channel topic/purpose, member stack, add-user action; direct-message audio/video only in the deferred call phase.
- Timeline: date dividers, history loading, sticky load-more affordance, compact posts, attachments, inline replies, reactions, typing indicator.
- Resizable composer: draft, reply/edit target, attachment chips, mention list, send action.

## Critical flows

### Select channel

- Sidebar selection opens/reuses the temporary preview tab unless explicitly pinned/opened as durable.
- Fetch cache/history if needed, call the server’s channel-view endpoint, update unread/mention state, restore scroll anchor, and focus the pane—not necessarily the editor.

### Create/send post

- Keep the draft per pane.
- Upload files first, then create the post with returned file IDs.
- Insert a local pending post with a generated client ID; reconcile REST response and websocket echo without duplication.
- On failure, retain text/files and mark the pending post failed with retry access.

### Search

- `⌘K` presents a keyboard-first palette.
- Under two characters: local channel matching only.
- At two or more: debounce 180 ms; concurrently query remote channels, posts, and users.
- Results open channel, jump to post, create/open DM, or open settings.

### Workspace

- Tabs may be temporary or durable. A durable existing tab is activated rather than duplicated unless explicitly requested.
- Tab context menu offers split-right, split-down, close, and close-others.
- Persist only durable tabs and a layout whose leaf IDs exactly match those tabs. Discard invalid/degenerated layouts rather than restoring an empty workspace.
