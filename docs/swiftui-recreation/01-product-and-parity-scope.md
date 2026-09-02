# Product and Parity Scope

## Product boundary

Antimatter Mac is a focused Mattermost-compatible desktop client, not an embedded Mattermost web app and not a social/chat-bubble product. It must interoperate through Mattermost public API behavior while remaining independent of Mattermost branding and server changes.

## Included behavior

- Connect by personal access token, username/password, and SAML SSO desktop callback.
- Navigate teams; public/private channels; direct and group messages.
- Show channel metadata, member stack, user presence, unread state, mentions, favorites, archive state, local emoji labels, collapsed sections, and local order.
- Open conversations as temporary preview tabs or persistent tabs; close, pin, split right/down, resize, and restore a valid workspace tree.
- Load history incrementally; preserve bottom anchoring, scroll position, and pending optimistic posts.
- Read and compose Markdown, replies, edits, files, images, emoji, Giphy links when configured, polls, and reactions.
- Search local channels plus remote channels, users, and posts from a command palette.
- Deliver native notifications subject to preference; provide settings and attachment preview.

## Deferred / conditional

- Direct audio/video calling is a late, experimental parity phase. The current implementation uses custom post signaling and WebRTC. Do not claim production parity until interoperability, NAT traversal, recovery, and privacy behavior are proven.
- iPadOS/iOS, multi-account, offline-first sync, enterprise administration, threads beyond current inline reply behavior, and server-side feature additions are out of scope.

## Parity principles

- Preserve semantics before visual polish: a selected channel must mark view state correctly, and a pending post must converge with its server post.
- Preserve local customizations, but distinguish them from server state.
- Gracefully support Mattermost-compatible server variations; surface actionable API errors.
- Avoid copying implementation details such as React stores, DOM state, or Electron RPC.

## Release gates

- Foundation release supports PAT, sidebar, one tab, channel history, plain Markdown send, websocket reconnect, and Keychain storage.
- Each later phase has its own acceptance criteria in `08-phased-implementation-roadmap.md`.
- “Parity complete” means the applicable checklist in `appendix/parity-matrix.md` passes on a real Mattermost-compatible server, not merely that views exist.
