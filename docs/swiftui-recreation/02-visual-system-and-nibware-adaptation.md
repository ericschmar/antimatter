# Visual System and Nibware Adaptation

## Visual contract

Use semantic tokens, never hard-code colors in feature views. Base type is SF Pro / system sans at 14 pt, with tabular numerals for times and counts. Keep radius mostly 6–8 pt; use 999 pt only for status dots and reaction pills.

- Default background `#111113`; panel `#18191b`; raised `#212225`; hover `#272a2d`.
- Subtle border `#363a3f`; strong border `#43484e`.
- Primary/secondary/muted text `#edeef0` / `#b0b4ba` / `#777b84`.
- Primary green `#46a758`; warm attention amber; danger red.
- Provide default dark, light, high-contrast dark, and warm themes from `appendix/design-tokens.md`.

## Required geometry

- Window content has a 32 pt title strip and a 1 pt outer border; do not recreate traffic lights in content when native titlebar controls are available.
- Default sidebar is 248 pt and user-resizable.
- Sidebar header is 52 pt; team tabs are 30 pt square; channel selection rows are 30 pt minimum.
- Conversation header is 54 pt. Composer begins at 72 pt, resizes up to `min(320 pt, 44% window height)`.
- Message rows use a 176 pt leading metadata column, then 8 pt gap and content. Avatar is 18 pt square with 4 pt radius, not a large circular profile image.

## Nibware rules

Nibware’s catalog provides self-contained SwiftUI source examples, not a dependency or design system. Before use:

1. Verify the license/attribution terms at the source page and record them in `ThirdPartyNotices.md`.
2. Copy only the necessary source into `UI/NibwareAdapted/`; do not import a remote runtime package.
3. Remove catalog-specific colors, assets, card modifiers, fixed device widths, and system-background assumptions.
4. Replace them with `AntimatterTheme` tokens and test in all four themes.

### Candidate: Chat Input

Adapt mechanics only: attach affordance, trailing send affordance, and content layout. Replace its 20 pt rounded white card and shadow with the existing 7 pt bordered, square-ish composer shell. Omit microphone unless the calling phase supplies a complete voice-message feature.

### Rejected: Chat Bubbles

Do not use. Its user/assistant bubbles, large radius, and conversational alignment directly conflict with the Antimatter message ledger.

### Rejected: Social Post Card

Do not use as a message-row base. Its circular 38 pt avatar, card structure, image prominence, and action bar are social-feed patterns, not compact workplace chat.

## Anti-patterns

- No gradients or glass-heavy materials.
- No alternating left/right bubbles, bubble tails, read receipts placed as bubble chrome, or phone-first safe-area layouts.
- No large floating cards around every post.
- No permanent visual clutter: reveal row actions on hover/focus, while retaining keyboard/context-menu access.
