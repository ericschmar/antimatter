---
name: antimatter-swiftui-recreation-plan
description: Create implementation-ready Markdown planning documentation for a clean-room native macOS SwiftUI recreation of Antimatter while preserving its dense desktop visual language and selectively adapting Nibware source components.
---

# Antimatter SwiftUI Recreation Plan

## Workflow

1. Read `README.md`, existing CSS visual tokens, workspace/sidebar/timeline/composer components, API client, websocket client, local storage, and workspace state before drafting.
2. Ask for the target Apple platform, parity scope, and whether the migration is fully native or hybrid.
3. Treat Nibware as selectively copied/adapted source after license verification. Reject its chat bubbles and social post cards for Antimatter’s message rows; adapt only useful mechanics such as input controls.
4. Write `docs/swiftui-recreation/` with product scope, visual/Nibware rules, information architecture, native architecture, Mattermost contracts/auth, SwiftUI/AppKit workspace design, component specifications, phased roadmap, quality/release plan, and appendices for tokens, parity, shortcuts, state machines, and risks.
5. Specify SwiftUI-first with focused AppKit bridges for split/tab workspace, rich editor, and desktop integration. Preserve workspace persistence invariants: temporary tabs never persist and every serialized layout leaf maps exactly to a durable pane.
6. Verify all documentation files are non-empty and contain no Markdown tables because Antimatter project instructions require lists.

## Visual invariants

- Do not turn the UI into iMessage: no alternating bubbles, bubble tails, large circular avatars, heavy cards, gradients, or phone-first layouts.
- Preserve graphite tokens, thin borders, 6–8 pt radii, compact rows, 248 pt resizable sidebar, ledger message metadata/content grid, grass-green primary actions, and amber mention attention.

## Native recommendations

- macOS 14+, Observation, Swift concurrency, URLSession, URLSessionWebSocketTask, Keychain, ASWebAuthenticationSession, UserDefaults/SwiftData for non-secrets.
- Stage custom WebRTC calls as experimental because current Antimatter calling is exploratory.

## Verification

```sh
find docs/swiftui-recreation -type f -name '*.md' -size +0c | wc -l
```