# Antimatter SwiftUI Recreation Plan

## Purpose

This folder is the implementation plan for a **clean-room, native macOS 14+ SwiftUI recreation** of Antimatter: a focused desktop client for Mattermost-compatible servers.

The target is not an iMessage-style messenger. It preserves Antimatter’s current product character:

- A compact, information-dense desktop workspace.
- A persistent team/channel sidebar plus a tabbed, splittable conversation workspace.
- Flat, ledger-like message rows with aligned metadata, not alternating chat bubbles.
- Graphite surfaces, thin dividers, restrained radii, green primary actions, and amber attention states.
- Mouse, keyboard, context-menu, drag-and-drop, and multi-pane workflows appropriate to macOS.

The plan assumes a new native Swift codebase. Existing TypeScript, ElectroBun, React, and Bun code is behavior and API-reference material only.

## Approved decisions

- **Platform:** macOS 14+.
- **UI:** SwiftUI first, with focused AppKit bridges where desktop behavior cannot be reliably expressed in SwiftUI.
- **Networking:** `URLSession` and `URLSessionWebSocketTask`.
- **Secrets:** Keychain only.
- **Features:** staged roadmap to Antimatter’s functional parity.
- **Nibware:** selectively copy/adapt individual source components after license verification; never adopt its AI-chat visual language wholesale.

## Reading order

1. `01-product-and-parity-scope.md`
2. `02-visual-system-and-nibware-adaptation.md`
3. `03-information-architecture-and-user-flows.md`
4. `04-native-architecture-and-data-model.md`
5. `05-mattermost-api-websocket-and-auth.md`
6. `06-swiftui-appkit-workspace-design.md`
7. `07-component-specifications.md`
8. `08-phased-implementation-roadmap.md`
9. `09-testing-accessibility-performance-and-release.md`
10. `appendix/` reference material

## Definition of visual success

A familiar Antimatter user should recognize the workspace before reading its name:

- Sidebar around 248 pt by default, resizable.
- 32 pt desktop title strip.
- 54 pt conversation header.
- Compact list rows and small (18–24 pt) avatars.
- Message metadata in a fixed leading column; content remains in a shared left-aligned document column.
- Hover reveals secondary controls; persistent controls stay quiet.
- No oversized circular avatars, bubble tails, marketing-card shadows, gradients, or phone-first composition.

## Source audit basis

This plan reflects the current repository’s documented and implemented surface:

- PAT, password, and SAML SSO authentication.
- Teams, channels, DMs, group DMs, favorites, archives, local ordering, unread and mention cues.
- Real-time posts and status events, typing, reactions, attachments, markdown, rich composition, polls, search, command palette, notifications, settings, and exploratory direct calls.
- Closable tabs, temporary previews, split-right/split-down panels, persisted workspace layout, drafts, reply/edit state, scroll anchors, and composer heights.

Calls are explicitly treated as an exploratory late phase because the current implementation is not a finished replacement for mature calling infrastructure.
