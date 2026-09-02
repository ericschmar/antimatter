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

The native client is a macOS 14+ Swift package. Open `Package.swift` in Xcode
to run the `Antimatter` executable, or run `swift build` from the repository
root. Use `ANTIMATTER_ENV=development` and, when useful for development,
`ANTIMATTER_SERVER_URL=https://mattermost.example.com`; credentials must never
be supplied through environment variables.

| Order | Feature | Status | Implementation notes |
| ---: | --- | --- | --- |
| 1 | Native application foundation | Complete | macOS 14+ SwiftUI package target, `AntimatterFoundation` boundary, unified logging, environment configuration, Keychain storage boundary, and unit-test target are in place. |
| 2 | Visual system and desktop shell | Complete | Graphite SwiftUI theme, typography, dividers, semantic green/amber colors, 32 pt title strip, 54 pt conversation header, and resizable 248 pt sidebar shell are in place. |
| 3 | Accessibility, keyboard, and window foundations | Complete | Accessible sidebar/workspace containers, keyboard focus routing, native commands, new-workspace-window support, and scene lifecycle logging are in place. |
| 4 | Server connection and authentication | Not started | Support server discovery/configuration plus password, personal-access-token, and SAML SSO sign-in; keep credentials exclusively in Keychain. |
| 5 | Mattermost API client and transport | Not started | Build authenticated REST requests, pagination, error handling, reconnecting `URLSessionWebSocketTask` transport, and an API test harness. |
| 6 | Local data store and synchronization | Not started | Model users, teams, channels, posts, preferences, unread state, and event reconciliation; persist enough data for fast startup and offline-tolerant rendering. |
| 7 | Team and channel navigation | Not started | Render teams, public/private channels, DMs, group DMs, archives, favorites, local ordering, unread badges, and mention cues in the persistent sidebar. |
| 8 | Conversation workspace and selection | Not started | Add the 54 pt conversation header, channel switching, temporary previews, closable tabs, and selection restoration. |
| 9 | Message timeline | Not started | Create compact, virtualized ledger-style message rows with 18–24 pt avatars, fixed metadata column, shared content column, date grouping, and scroll anchoring. |
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
