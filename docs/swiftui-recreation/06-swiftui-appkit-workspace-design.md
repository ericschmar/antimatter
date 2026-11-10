# SwiftUI and AppKit Workspace Design

## Approved Rune foundation replacement

The user approved the first issue #4 slice on 2026-11-10. For the existing
single-conversation presentation only, Rune elements and same-pin `rune-kit`
controls/sidebar mechanics replace the SwiftUI screen/host prescription in
Approach and Conversation implementation below. A shared Antimatter theme
retains document 02 geometry and identity; reuse native window controls rather
than drawing traffic lights. Sidebar resizing is window-local in this slice.
The current session, checkpoint, composer lock and pending-delivery guards
remain authoritative under `src/SPEC.md`; presentation does not remove them.

The `NSViewRepresentable`/`NSSplitView`/custom AppKit tab implementation below
is reference intent awaiting the later Rune tab/split design. Product pane
independence, tree validation, temporary/durable semantics, scroll anchors and
keyboard/accessibility requirements remain unchanged and unimplemented by this
foundation. The singleton Settings owner remains authoritative; Kit Page is
not a substitute. No new native binding/window registry is approved here.

Verification requires synthetic keyed navigation and resize scripts, composer
lock/retry semantics, accessibility/tree assertions and visually inspected PNGs,
plus existing offline service/session tests. No credential or account store
is opened headlessly. Native window, IME/VoiceOver and live parity require
separate authorized checks; a synthetic shell is not workspace parity.

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
