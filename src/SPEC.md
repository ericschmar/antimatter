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
  before publishing an authenticated session. This entry is session-only: it
  does not save credentials or drafts, restore accounts or perform durable sign-out.
- `lib.rs`: `SessionScope` owns session generation and cancellation. Replacement
  or disconnect cancels the previous future and clears rendered session data.
  Every background completion checks its generation before changing UI state.
- [Service contract](services.spec.md): background REST/socket/conversation work.
  Publish small updates through `AppHandle::update`; never perform blocking
  filesystem/Keychain work, HTTP or wire decoding on the UI thread.

## Conversation interaction

Enqueue successfully before changing the selected channel or locking a send;
queue failure retains the prior timeline and draft. Serialize channel loads and
prevent selection changes while loading or while draft/pending text exists.
This single-conversation ceiling does not satisfy concurrent workspace panes.

Lock the composer immediately after send enqueue, not after its acknowledgement.
At the pinned Rune version, `disabled`/`read_only` alone do not prevent editing:
locked input has no edit binding and is inert. Disabled buttons are inert and
also guard their handlers. Only `Ready` controls refresh readiness; a pending
acknowledgement cannot unlock an unfinished refresh. Successful acknowledgement
clears the submitted draft; failure retains it. Disconnect explicitly warns that
session-only drafts and pending-delivery state are discarded.

## Rendering and export boundary

Native default is the conversation entry. Headless default and the `hello`/`on`
scenes preserve the hello switch and spring check. `auth-proof` uses only fake
secure values; `conversation-proof` renders only synthetic conversation data.
Headless initialization creates no service runtime and accesses no account store.
`--real-account` rejects headless execution, and native execution rejects tracing.
Never export credentials or real conversation/account data into test artifacts.

## Runnable verification

`cargo test --locked --offline --bin antimatter` checks the spring, immediate
composer lock including attempted paste, refresh readiness, enqueue failure,
stale-session rejection and Rune-driven loopback load/send/delivery checking.
`python3 scripts/rune-headless.py` checks synthetic rendering/accessibility,
secure-input redaction and export/trace rejection. Inspect rendered PNGs in
ignored `build/rune-headless/`; metadata is not visual or native parity proof.

Native Keychain/browser callback delivery, authorized live-server conversation,
durable account/draft orchestration and full workspace behavior require separate
checks and implementation; this contract grants no claim of their completion.
