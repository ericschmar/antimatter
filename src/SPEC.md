---
id: antimatter-rust-runtime
type: module-design
title: Rune application and session runtime
status: active
parent: antimatter
depends-on: [antimatter-rust-services]
---

# Rune runtime contract

This source-adjacent spec records the existing Rust boundary, not additional
feature approval. [Root ownership](../SPEC.md) and the approved replacement
sections in [architecture/data](../docs/swiftui-recreation/04-native-architecture-and-data-model.md)
and [API/auth](../docs/swiftui-recreation/05-mattermost-api-websocket-and-auth.md)
remain authoritative for shared contracts. Changes must reconcile both owners
and this implementation contract; source behavior does not supersede intent.
GitHub issues own execution status, not these specs.

## Source boundaries

- `main.rs`: Rune presentation, secure inputs and view intents; native execution
  creates one Tokio runtime. Fresh PAT/password sign-in validates `/users/me`
  before publishing an authenticated session. Fresh login is session-only unless
  Remember is explicitly enabled. Native startup reads only Rust registry/selection
  metadata; saved credential access and `/users/me` validation require explicit
  Connect saved. Saved identity must match the validated user. SAML uses the
  retained native browser adapter and the same authentication completion path.
- `lib.rs`: `SessionScope` owns session generation and cancellation. Replacement
  or disconnect checkpoints durable state before cancelling the previous future
  and clearing rendered session data. Accepted persistence commands are not
  rolled back by cancellation; cancellation is disabled during auth publication.
  Every background completion checks its generation before changing UI state.
- [Service contract](services.spec.md): background REST/socket/conversation work.
  Publish small updates through `AppHandle::update`; never perform blocking
  filesystem/Keychain work, HTTP or wire decoding on the UI thread.

## Conversation interaction

Enqueue successfully before changing the selected channel or locking a send;
queue failure retains the prior timeline and draft. Serialize channel loads and
prevent selection changes while loading or while pending delivery exists.
Durable channel/account transitions checkpoint pane/channel drafts first;
session-only channel transitions still block when draft text exists.
This single-conversation ceiling does not satisfy concurrent workspace panes.

Lock the composer immediately after send enqueue, not after its acknowledgement.
At the pinned Rune version, `disabled`/`read_only` alone do not prevent editing:
locked input has no edit binding and is inert. Disabled buttons are inert and
also guard their handlers. Only `Ready` controls refresh readiness; a pending
acknowledgement cannot unlock an unfinished refresh. Successful acknowledgement
clears the submitted draft only after its durable acknowledgement checkpoint;
failure retains it. Durable sends checkpoint a reserved `conversation-pending`
pane before enqueue. A clean close before enqueue rolls that marker back to an
ordinary draft; accepted sends keep it. Restored markers never authorize resend
and currently lock send/switch/sign-out pending a later recovery UI. Marker text
is retained, but full pending UUID/reconciliation recovery remains outstanding.

`Persistence` owns one dedicated blocking-I/O thread. Rune turn completion
autosaves changed drafts/navigation, serializing completions and preventing stale
close snapshots from restoring acknowledged markers. Clean close drains writes;
Rune cannot veto close, so disk failure or a crash before commitment can retain
only the last durable edit. The UI warns about this ceiling; it is not a data-loss
guarantee. Explicit save/retry remains available. Sign-out cancels the matching
authenticated identity even for a session-only connection to a saved account.
Session-only disconnect warns that in-memory drafts/pending state are discarded.

## Rendering and export boundary

Native default is the conversation entry. Headless default and the `hello`/`on`
scenes preserve the hello switch and spring check. `auth-proof` uses only fake
secure values; `conversation-proof` renders only synthetic conversation data.
Headless initialization creates no service runtime and accesses no account store.
`--real-account` rejects headless execution, and native execution rejects tracing.
Never export credentials or real conversation/account data into test artifacts.

## Kit-backed workspace foundation

The approved first workspace slice uses `rune-kit` at the same exact git revision
as Rune. Reuse generic controls/sidebar mechanics and the existing Rune editor, not OpenCode theme assets.
A shared presentation theme maps the owning Antimatter semantic colors and
compact typography/geometry onto Kit. The native conversation entry presents
a 248 pt resizable sidebar, compact keyed channel rows, 32 pt title strip,
54 pt conversation header, and 176 pt metadata/8 pt gap message ledger.
Reuse existing load/checkpoint/send/retry paths; loading, queued send, ambiguous
delivery and restored markers keep their current guards. No editor binding
is attached to a locked composer; it remains inert. Kit control replacement
must retain disabled-handler and accessibility checks.

Synthetic workspace scenes may demonstrate navigation, sidebar resizing and
locked/retry states without services, credential/storage access or OS actions.
Synthetic local transitions never publish real intents or modify durable state.
Sidebar width is window-local for this foundation; durable pane/layout and
preference restoration are subsequent work, not implied by presentation.
This single-conversation slice does not implement tab/split workspaces,
incremental history anchors, rich message actions or Settings. An in-window Kit
Page must not replace the independent native singleton.

## Unread and viewed state

The user approved this second issue #4 slice on 2026-11-10. Refresh requests each
navigated channel's `/users/me/channels/{id}/unread` counts (bounded concurrency)
and publishes them with `Navigation`; a failed or mismatched lookup keeps the last
known count, so counts are advisory and never block readiness. After a successful
load/refresh of the active channel the worker posts the channel-view endpoint
(previous channel recorded by the last load) and clears that channel locally only
when the server accepted it; failure is silent and retried by the next refresh.
`posted` events for other channels from other users add an advisory delta (a
mention only when the event's `mentions` names the current user); `channel_viewed`
clears a channel. Deltas are replaced by server counts at the next refresh/reconnect.
The sidebar shows `@N` for mentions or an unread dot otherwise. Counts are
session-only and never persisted. Tabs, preview/durable semantics and per-pane
unread remain later work.

## Runnable verification

`cargo test --locked --offline --bin antimatter` checks the spring, immediate
composer lock including attempted paste, refresh readiness, enqueue failure,
stale-session rejection and Rune-driven loopback load/send/delivery checking.
`python3 scripts/rune-headless.py` checks synthetic rendering/accessibility,
secure-input redaction and export/trace rejection. Inspect rendered PNGs in
ignored `build/rune-headless/`; metadata is not visual or native parity proof.

Native Keychain/browser callback delivery, authorized live-server conversation,
full pending-delivery recovery, legacy import UI and full workspace behavior
require separate checks and implementation; this contract grants no claim of
their completion. The native helper builds an unsigned, unregistered bundle with
`antimatter.ericschmar.dev` (the user-authorized Swift identity) and `mattermost-dev`.
Browser start fails closed unless the running main bundle declares both. Metadata
checks do not prove LaunchServices delivery or authorized live/SAML acceptance.
