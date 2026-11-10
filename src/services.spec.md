---
id: antimatter-rust-services
type: module-design
title: Rust Mattermost conversation and account services
status: active
parent: antimatter
---

# Rust services contract

This source-adjacent spec names module responsibilities and verification for the
approved Rust implementation. [Architecture/data](../docs/swiftui-recreation/04-native-architecture-and-data-model.md)
and [API/WebSocket/auth](../docs/swiftui-recreation/05-mattermost-api-websocket-and-auth.md),
including their approved replacement sections, retain shared behavioral/security
ownership. [Root](../SPEC.md) retains migration boundaries. These links remain
normative even though the legacy documents are not graph-indexed. Reconcile the
owning document and this contract together when intent changes; GitHub issue #3
owns progress and blockers.

## Transport and authentication

`mattermost.rs` owns canonical origin validation, endpoint construction, typed
wire models, safe errors and reqwest REST/PAT/password/SAML exchange. Authenticate
only origin-matched API/media requests, reject credential-bearing redirects,
require HTTPS unless development HTTP is explicitly enabled, and retain normal
TLS validation. Both transports use compatible native-root Rust TLS features.
Secrets are zeroizing/redacted and never serialized into UI or durable records.
All login methods validate `/users/me`; SAML callbacks are random, one-shot,
generation-bound and shape-validated before exchange.

`macos.rs` owns Rust-authored `ASWebAuthenticationSession` bindings, retained
session/presentation anchor and cancellation completion. Start/cancel on the UI
thread; no embedded browser or Swift FFI. Actual bundle callback registration
and browser delivery are native verification requirements, not Cargo guarantees.

`websocket.rs` owns authentication, monotonic sequences, receive/heartbeat,
backoff, cancellation and refresh signaling. Socket creation alone is not
connected. Ping every 25 seconds with a 10-second reply deadline; reconnect delay
caps at 30 seconds and resets after authentication. Auth rejection suspends
reconnect; cancellation never reconnects. Decode nested JSON objects or strings.

## Conversation worker

`conversation.rs` consumes `Load`, `Send`, `Retry`, `Refresh` and socket events.
The parent owns session cancellation and rejects stale-generation updates.
Navigation pages contain 200 channels; the visible history page contains 60 posts.
Validate ordered post IDs and all map entries, allowing unordered thread parents.
Refresh replaces the latest-page snapshot, removing offline deletions, and refreshes
navigation/history before `Ready(true)`. Authentication triggers refresh even on
the first connection. Nonfatal malformed frames do not imply connectivity loss.

Keep one pending send, its text and stable UUID. Match acknowledgements by server
ID and pending identity with validated author/channel; reject conflicting IDs.
Posted/edited/deleted events and HTTP results share deduplication. Only a definitive
client rejection (4xx except 408) allows explicit resend. Transport, decoding,
timeout and 5xx outcomes are ambiguous: retain text and check delivery without
resending. Ordinary history does not persist `pending_post_id`; neither exhaustive
absence nor the bounded server dedup cache proves a resend safe. Pagination has
a 10,000-page fail-closed ceiling, not a durable-idempotency guarantee.

## Account persistence boundary

`accounts.rs` owns the validated canonical-origin plus `/users/me` user-ID tuple,
opaque account directories, versioned atomic restrictive-permission non-secret
records, account-local pane/channel drafts and the separate Rust Keychain namespace.
Credential success precedes publishing account metadata. Reject corrupt/unknown
versions or unsafe paths without overwriting prior state; surface deletion/write
failures. Serialize persistence writers and run blocking I/O off executor workers.

Selected legacy-token import is copy-only, opt-in and validation-first; existing
Rust entries win. Never enumerate legacy state at startup or infer ownership of
host-only caches/global drafts. Do not persist posts, users, authenticated responses
or media in this scope. The native session-only UI does not yet exercise this
persistence boundary; module primitives alone do not prove saved-account parity.

## Runnable verification and external gates

`cargo test --locked --offline --lib` exercises origin/redirect/auth/error contracts,
loopback socket lifecycle with controllable time, account isolation/atomic failures,
copy-only import, realistic stripped pending IDs/delayed commits, explicit rejection
retry, offline deletion, threaded history and refresh readiness. Tests use only
synthetic credentials, loopback servers and temporary roots/fake credential stores.
Run strict all-target Clippy and formatting alongside the tests.

Native Keychain CRUD must use a clearly isolated synthetic service. Real SAML
requires confirmed bundle/callback identity and an authorized SAML server. Live
load/send/retry/reconnect is a separate acceptance gate; synthetic tests cannot
close it or establish release/macOS-floor readiness.
