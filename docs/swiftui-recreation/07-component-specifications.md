# Component Specifications

## Reusable primitives

- `AntimatterTheme`: semantic colors, spacing, typography, borders, radii.
- `Surface`, `IconButton`, `SecondaryButton`, `PrimaryButton`: 6–7 pt corners; primary green only for committed actions.
- `AvatarView`: square/rounded-square for message metadata; circular only where current UI uses member-stack presence avatars.
- `StatusDot`, `ReactionPill`, `AttachmentChip`, `HoverActions`, `EmptyWorkspaceView`.

## Sidebar components

`SidebarView`, `TeamSwitcher`, `ChannelSectionView`, `ChannelRow`, `AccountMenu`.

`ChannelRow` states: default, hover/focused, selected, unread, mentioned, dragging, favorite. Required interactions: single select, double-click pin/open durable tab, open-in-tab action, favorite action, context menu, drag reorder, keyboard navigation.

## Timeline components

`TimelineView`, `DateDivider`, `MessageRow`, `MessageMetadata`, `MarkdownContent`, `AttachmentList`, `ReplyExcerpt`, `ReactionBar`, `TypingIndicator`, `LoadEarlierButton`.

Message rows must retain the fixed metadata/content grid on desktop. Own messages receive only a subtle 2 pt leading indicator. Hover shows reply/reaction actions. Markdown must support GFM necessities: paragraphs, links, lists, quote, inline/block code, headings, tables, images, and mention highlighting. Treat server content as untrusted.

## Composer components

`ComposerView`, `MarkdownEditorBridge`, `ComposerToolbar`, `MentionSuggestionList`, `ReplyEditBanner`, `AttachmentDraftList`, `PollSheet`.

Required behavior:

- Enter sends; Shift-Enter inserts newline.
- Arrow keys, Enter/Tab, Escape operate an open mention list.
- `@` search excludes self and caps suggestions at eight.
- Throttle typing updates to four seconds.
- Preserve code-like multiline pastes as code blocks/source content.
- File picker and drag/drop append removable chips; send remains enabled for attachments with no text.
- Rich/source Markdown mode includes undo, text formatting, lists, links, tables, divider, code block, image/file, emoji, GIF where configured, and poll.

## Overlays

Use SwiftUI sheets/popovers for create channel/DM, poll, settings, emoji, Giphy, user detail, and command palette. Use a full-window panel or Quick Look for attachment previews. Match existing compact border/shadow treatment; avoid large rounded modal cards.
