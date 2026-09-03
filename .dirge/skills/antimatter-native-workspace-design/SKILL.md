---
name: antimatter-native-workspace-design
description: Design native SwiftUI workspace surfaces in Antimatter while preserving its dense desktop visual language and existing navigation behavior.
---

# Native Workspace Design

## Discovery

Before proposing a workspace-area redesign, inspect the relevant SwiftUI view, `WorkspaceShell.swift`, and `WorkspaceTheme.swift`. Identify which behavior and state must remain unchanged before suggesting presentation changes.

## Channel Sidebar Direction

Use a dense editorial utility-panel treatment rather than generic stacked navigation sections:

- Preserve the 248 pt desktop sidebar footprint, dark slate `WorkspaceTheme` surfaces, configurable accent, ordering, unread and mention state, avatars, and presence.
- Favor a compact workspace strip and keyboard-first command/search trigger over a large padded header.
- Give mentions and aggregate unread activity a conditional attention shelf, so urgent activity has a stable location.
- Use quiet uppercase section labels, thin dividers, and compact 30 pt conversation rows. Do not keep persistent section icons when text and structure already identify the group.
- Show a 2 pt near-full-height accent selection rail with a muted raised selected surface. Hover surfaces should be faint and should not add outlines.
- Express ordinary unread state with semibold labels and aligned figures. Reserve a compact amber pill for mentions.
- Reveal trailing row overflow and section add affordances only on hover.
- Preserve keyboard access and accessibility text for conversation type, unread state, mention count, and presence; never rely on color or iconography alone.

## Scope

Keep presentation work focused in `ChannelSection.swift` and the sidebar area of `WorkspaceShell.swift`. Do not alter the navigation model or channel behavior merely to implement a visual redesign.

## Verification

For an implementation, run:

```sh
swift build
swift test
git diff --check
```
