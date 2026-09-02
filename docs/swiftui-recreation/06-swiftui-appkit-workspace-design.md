# SwiftUI and AppKit Workspace Design

## Approach

Build screens in SwiftUI. Bridge to AppKit only for desktop behavior that SwiftUI does not make dependable: nested resizable split trees, closable tab strips, advanced rich text editing, drag/drop precision, and Quick Look integration.

## Workspace host

Create `WorkspaceHost: NSViewRepresentable` backed by an `NSViewController` that renders a `WorkspaceNode` tree:

- `split(axis, ratio, first, second)` maps to `NSSplitView` with a stored proportional ratio.
- `group(id, selectedPaneID, paneIDs)` maps to a custom AppKit tab strip plus one hosted SwiftUI pane.
- `pane(id, channelID)` hosts `ConversationPane` using `NSHostingController`.

A custom tab strip is preferred over `NSTabView` because it needs compact flat tabs, hover-only close controls, temporary italic labels, context menus, and controlled persistence. Use native menu validation and first-responder routing for close/split commands.

## Persistence invariants

- Every leaf references exactly one current pane.
- Every durable pane appears exactly once in the tree.
- Temporary panes are never persisted.
- On restore, validate all invariants before constructing AppKit views; otherwise start from durable panes in one group.
- Store split ratio in `[0.15, 0.85]`; clamp during restore.

## Conversation implementation

`ConversationPane` is SwiftUI and owns header/timeline/composer composition. `ScrollView` plus `LazyVStack` is acceptable for initial history volumes; add an AppKit-backed or custom virtualized list only after measurements show it is needed. Preserve bottom position for active conversations; when prepending history, restore the visible anchor instead of jumping.

Use `NSTextView` through `NSViewRepresentable` for the rich composer once the required Markdown source/rich mode, selection-aware mentions, code-preserving paste, keyboard behavior, and toolbar actions exceed `TextEditor`. Keep the editor model as Markdown text; formatting is a convenience layer, not the source of truth.

## Menus and commands

- `CommandMenu` and app `Commands` define `⌘K`, compose focus, close tab, split right/down, attach file/image, emoji picker, and settings.
- Row/context menus use `contextMenu` when they meet behavior needs; use `NSMenu` bridge for services or dynamic native integration.
- Accessibility focus must move predictably after tab close, split, palette dismissal, and send.
