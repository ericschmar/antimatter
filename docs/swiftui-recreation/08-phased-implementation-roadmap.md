# Phased Implementation Roadmap

## Phase 0 — Foundation

- Create Xcode project, target macOS 14+, Swift concurrency baseline, module folders, tokens, Keychain wrapper, test fixtures, and build signing plan.
- Implement auth shell and PAT bootstrap.
- Exit criteria: connects to a real server, token is Keychain-only, default/light/high-contrast/warm themes render.

## Phase 1 — Core workspace

- Bootstrap teams/channels/current user; sidebar sections and selection; one conversation pane; REST history; plain Markdown composer; optimistic send; websocket post/reconnect.
- Exit criteria: user can use channels and DMs for a workday without duplicate/lost visible posts or token leakage.

## Phase 2 — Desktop navigation fidelity

- Favorites, local order/archive/emoji labels, collapsed sections, unread/mention, team switcher, channel create/DM create/member add, presence, native menu commands.
- Implement tab groups, temporary previews, durable tabs, close/pin, split right/down, resize, validation and persistence.
- Exit criteria: restored workspace never opens empty because of an invalid snapshot.

## Phase 3 — Message fidelity

- Full Markdown renderer, attachments/images/authenticated downloads, reactions, replies, edit/delete, typing, date dividers, history pagination/anchor retention, attachment preview.
- Exit criteria: scroll remains stable across image loads and prepended history; failed sends preserve retryable drafts.

## Phase 4 — Composition and search

- `NSTextView` Markdown editor bridge, toolbar, code paste, mentions, emoji, optional Giphy, polls, command palette with debounced remote search.
- Exit criteria: keyboard-only composer/palette operation works with VoiceOver and no accidental Enter sends while choosing mentions.

## Phase 5 — Native integrations

- Notifications and preference policy, sounds, settings window, update/error presentation, import/export diagnostics only if needed.
- Exit criteria: notification privacy and focus behavior pass manual verification.

## Phase 6 — Experimental calls

- Port custom signaling only after a native WebRTC strategy is selected and documented. Verify permission flows, audio/video rendering, TURN/STUN config, interruption cleanup, and no call metadata persistence beyond required recovery marker.
- Exit criteria: explicitly labeled experimental until multi-network testing is successful.

## Per-phase practice

Write tests alongside models/services, run unit tests and UI smoke tests, then profile a realistic workspace before moving on. Do not start a later phase by weakening earlier acceptance criteria.
