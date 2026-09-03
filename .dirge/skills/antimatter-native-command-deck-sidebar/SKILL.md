---
name: antimatter-native-command-deck-sidebar
description: Implement the dense Command Deck channel sidebar in Antimatter’s native SwiftUI workspace while preserving navigation behavior.
---

# Native Command Deck Sidebar

## Layout

- Keep `WorkspaceTheme.sidebarWidth` and use the existing `HSplitView` sidebar.
- Replace the oversized team header with a 52 pt team/account row and a 36 pt search row.
- Add an optional attention shelf above channel sections; show it only when mentions or unread channels exist.
- Use `NavigationViewModel` computed properties for total mentions and unread-channel count rather than duplicating channel filtering in the view.

## Channel tree

- Use 10 pt tracked uppercase section labels with a compact collapse chevron and count.
- Do not add category icons to section headers.
- Keep rows at 30 pt, retain drag reordering and context menus, and use the existing direct-message avatar/presence view.
- Show ordinary unread counts as subdued text; show mentions as an amber capsule.
- Show selection as a muted raised surface and 2 pt accent rail, never as a filled accent row.

## Verification

Run:

```sh
swift build
swift test
git diff --check
```
