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

## Ordered implementation plan

Status is for the new SwiftUI application, not the existing TypeScript application.
Complete each row's dependencies before starting it; rows with the same order
may proceed in parallel once their shared prerequisites are stable.

### Native development

The native client is a macOS 14+ Swift package with an Xcode application
target. Open `Antimatter.xcodeproj` in Xcode and run the `Antimatter` scheme
to launch the bundled application. The Swift package remains available for
command-line builds and tests:

```sh
swift build
swift test
```

Use `ANTIMATTER_ENV=development` and, when useful for development,
`ANTIMATTER_SERVER_URL=https://mattermost.example.com`; credentials must never
be supplied through environment variables.

| Order | Feature | Status | Implementation notes |
| ---: | --- | --- | --- |
| 1 | Native application foundation | Complete | macOS 14+ SwiftUI package target, `AntimatterFoundation` boundary, unified logging, environment configuration, Keychain storage boundary, and unit-test target are in place. |
| 2 | Visual system and desktop shell | Complete | Graphite SwiftUI theme, typography, dividers, semantic green/amber colors, 32 pt title strip, 54 pt conversation header, and resizable 248 pt sidebar shell are in place. |
| 3 | Accessibility, keyboard, and window foundations | Complete | Accessible sidebar/workspace containers, keyboard focus routing, native commands, new-workspace-window support, and scene lifecycle logging are in place. |
| 4 | Server connection and authentication | Complete | Server validation, password and personal-access-token sign-in, SAML browser sign-in with callback verification, and Keychain-only token persistence are in place. |
| 5 | Mattermost API client and transport | Complete | Authenticated REST GET/POST requests, bounded pagination, decoded server errors, reconnecting `URLSessionWebSocketTask` events, and URL-protocol API tests are in place. |
| 6 | Local data store and synchronization | Complete | Local atomic snapshots cover users, teams, channels, posts, preferences, and unread state; navigation hydrates from cache before refresh and posted WebSocket events reconcile cached posts. |
| 7 | Team and channel navigation | Complete | Server-backed teams and channels, categorized persistent navigation, locally persisted favorites, alphabetical ordering, archives, unread dots, and mention counts are in place. |
| 8 | Conversation workspace and selection | Complete | Channel selection opens replaceable previews, tabs can be retained or closed, and tab/selection state is restored between launches. |
| 9 | Message timeline | Complete | Recent channel posts hydrate from the local store before refresh, then render as compact, virtualized ledger rows with 22 pt avatars, fixed author/time metadata, shared content, date grouping, selectable text, and latest-message scroll anchoring. |
| 10 | Rich message rendering | Not started | Render Mattermost markdown, links, code, emoji, attachments, and file actions without adopting chat-bubble presentation. |
| 11 | Real-time conversation updates | Not started | Apply post, reaction, channel, unread, and user-status WebSocket events to the active timeline and navigation state; preserve scroll position appropriately. |
| 12 | Reactions | Not started | Show reaction summaries, add/remove reactions, and reconcile optimistic changes with server events. |
| 13 | Composer and drafts | Not started | Implement rich text composition, paste and drag-and-drop attachments, per-conversation drafts, persisted composer height, and sending state. |
| 14 | Replies and post editing | Not started | Add reply state/thread context, edit flows, cancellation, draft recovery, and permission/error feedback. |
| 15 | Typing and presence | Not started | Send and display typing indicators and live user-status/presence updates. |
| 16 | Workspace splits and layout persistence | Not started | Support split-right and split-down conversation panes, independent pane selection/scroll state, tab movement, and persisted workspace layout. |
| 17 | Channel and message context actions | Not started | Provide native context menus and mouse workflows for posts, channels, tabs, attachments, reactions, and pane operations. |
| 18 | Search | Not started | Implement server-backed message/channel search, result navigation, filters, keyboard invocation, and opening results in the workspace. |
| 19 | Command palette | Not started | Add a keyboard-first command palette for navigation and workspace actions, backed by the same command definitions as menus and shortcuts. |
| 20 | Polls | Not started | Render polls, submit/update votes, show results, and reconcile real-time poll-related post updates. |
| 21 | Notifications | Not started | Add macOS notification permission, routing to the relevant conversation, quiet behavior, and preference-aware mention/unread triggers. |
| 22 | Settings and account management | Not started | Provide server/account management and user-facing preferences for notifications, appearance, behavior, and workspace defaults. |
| 23 | Native polish and release hardening | Not started | Validate performance at large message/channel volumes, accessibility, failure/reconnect paths, migration of persisted state, packaging, signing, and release operations. |
| 24 | Direct calls | Deferred — exploratory | Investigate a minimal direct-call workflow only after messaging parity; the current implementation is not a mature calling reference, so do not make calls a parity gate. |
