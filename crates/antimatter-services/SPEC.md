---
id: antimatter-rust-services
type: module-design
title: Rust Mattermost conversation and account services
status: active
parent: antimatter
---

# Rust services contract

This source-adjacent spec names module responsibilities and verification for the
approved Rust implementation. [Architecture/data](../../docs/swiftui-recreation/04-native-architecture-and-data-model.md)
and [API/WebSocket/auth](../../docs/swiftui-recreation/05-mattermost-api-websocket-and-auth.md),
including their approved replacement sections, retain shared behavioral/security
ownership. [Root](../../SPEC.md) retains migration boundaries. These links remain
normative even though the legacy documents are not graph-indexed. Reconcile the
owning document and this contract together when intent changes; GitHub issue #3
owns progress and blockers.

## Transport and authentication

the `mattermost` module (`mattermost/`) owns canonical origin validation, endpoint construction, typed
wire models, safe errors and reqwest REST/PAT/password/SAML exchange. Authenticate
only origin-matched API/media requests, reject credential-bearing redirects,
require HTTPS unless development HTTP is explicitly enabled, and retain normal
TLS validation. Both transports use compatible native-root Rust TLS features.
Secrets are zeroizing/redacted and never serialized into UI or durable records.
All login methods validate `/users/me`; SAML callbacks are random, one-shot,
generation-bound and shape-validated before exchange.

`macos.rs` owns Rust-authored `ASWebAuthenticationSession` bindings, retained
session/presentation anchor and cancellation completion. Start/cancel on the UI
thread; no embedded browser or Swift FFI. The user-authorized bundle identity is `antimatter.ericschmar.dev`, with
`mattermost` callback. Browser start validates actual main-bundle declarations
and retains the native key/main window; the ignored native bundle helper does not
launch, register or sign it. Actual callback delivery remains native verification,
not a Cargo or plist guarantee.

`websocket.rs` owns authentication, monotonic sequences, receive/heartbeat,
backoff, cancellation and refresh signaling. Socket creation alone is not
connected. Ping every 25 seconds with a 10-second reply deadline; reconnect delay
caps at 30 seconds and resets after authentication. Auth rejection suspends
reconnect; cancellation never reconnects. Decode nested JSON objects or strings.
Outbound `user_typing` frames (`data.channel_id`, `data.parent_id`) are written only
after authentication, from a bounded `Typing` channel the conversation worker feeds;
a dropped sender disables that branch without ending the socket.

## Conversation worker

`conversation.rs` consumes `Load`, `Send`, `Retry`, `Refresh` and socket events.
The parent owns session cancellation and rejects stale-generation updates.
Navigation pages contain 200 channels; the visible history page contains 60 posts.
Validate ordered post IDs and all map entries, allowing unordered thread parents.
Refresh replaces the latest-page snapshot, removing offline deletions, and refreshes
history before navigation, so the open channel's timeline is emitted before the team,
channel, and unread lookups. It then emits navigation, clears the open channel's unread
count, and reports `Ready(true)`. Group-member lookups for navigation run eight at a time.
Each team's channel memberships mark its channels `muted` when `notify_props.desktop` is
`none`; a failed membership lookup leaves those channels unmuted.
Authentication triggers refresh even on the first connection. Nonfatal malformed frames
do not imply connectivity loss.

Older history is an explicit `Older` intent: one page (60 posts) before the oldest
loaded post, using the `before` cursor, prepended as `Update::Older` with `has_older`
(from `prev_post_id`). Refresh keeps previously paged-back posts only while they are
absent from the newest page, so offline deletions in the newest window still drop.
Refresh also reads per-channel unread counts (`ChannelUnread`, bounded concurrency,
advisory on failure) and, after the active channel's timeline is published, posts
the channel-view request (best effort, idempotent). Peer avatars are fetched
concurrently (bounded) after `Ready(true)`, so neither the sidebar nor the channel waits on them. `posted`/`channel_viewed`
events adjust counts without ever acknowledging pending sends.

Typing is realtime and advisory. `typing` events are published as `Update::Typing` only when
their channel is the active channel and the user is not the current user; the channel comes from
`data` or `broadcast`, and a missing channel or user is an invalid event. Display names are
resolved best effort. `Intent::Typing` forwards to the socket with `try_send` and is dropped
when the socket queue is full, so typing never blocks sends, refresh or acknowledgements.

Display names are best effort and advisory. Direct channels (`D`, `id1__id2`) resolve
their label from the peer's user (full name, then nickname, then username); a self-DM is
"You"; a failed lookup falls back to the peer user ID. Timeline posts carry a
`names` map (user ID to display name) resolved the same way, and failure falls back to the
user ID. Names are cached per session and never acknowledge or alter pending sends.

The server name is Mattermost's `SiteName` from `/api/v4/config/client?format=old`,
fetched best effort once per session during navigation refresh and carried on
`Update::Navigation { site_name }`. A failed or empty fetch is retried on the next refresh
and the UI falls back to the saved origin; it never blocks readiness.

Keep one pending send, its text and stable UUID. Match acknowledgements by server
ID and pending identity with validated author/channel; reject conflicting IDs.
Posted/edited/deleted events and HTTP results share deduplication. Only a definitive
client rejection (4xx except 408) allows explicit resend. Transport, decoding,
timeout and 5xx outcomes are ambiguous: retain text and check delivery without
resending. Ordinary history does not persist `pending_post_id`; neither exhaustive
absence nor the bounded server dedup cache proves a resend safe. Pagination has
a 10,000-page fail-closed ceiling, not a durable-idempotency guarantee.

## Post search

`mattermost/client.rs` owns `POST /posts/search`. `search_posts` sends the terms as given. `PostSearchFilters`
turns the structured filters into Mattermost search modifiers appended to the trimmed query, in this order:
`in:` (channel name), `from:` (sender username), `after:`/`before:` (`YYYY-MM-DD`; a value that is not exactly
that shape adds nothing), `has:files`, `ext:` (extension with leading dots trimmed), `-is:reply` (roots)
or `is:reply` (replies), `is:pinned` and `is:saved`. Empty fields add nothing. `search_posts_filtered` is
the only caller that applies filters, and `is_or_search` stays false. `is_active` counts only well-formed
dates, so a search with nothing else to send is not run. The services layer does a shape check on dates and
does not parse them as calendar dates.

## Polls

`mattermost/models.rs` models Matterpoll polls. `Post.props` is `Option<Poll>` (the poll's `poll_id` and attachments),
and `Post::poll()` returns it only when `type` is `custom_matterpoll`. `PollAction` splits a trailing
` (n)` from the option label: `option()` gives the text and `vote_count()` gives `Some(n)` only when present.
`is_vote()` matches `button` actions whose id starts with `vote`, excluding `resetVote`.

`Client::create_poll` posts `/poll` with every question and option quoted (inner quotes escaped) and appends
`--progress`, so vote counts are reported. `vote_poll` and `end_poll` post the action (`end_poll` also submits the
Matterpoll end-confirmation dialog) and then re-fetch the post; the caller gets the server's copy. None of these
retry, because a repeated `/poll` would create a second poll.

## Giphy search

`giphy.rs` owns the optional GIF search: one authenticated GET to Giphy's
`/v1/gifs/trending` (featured) or `/v1/gifs/search` with the public key, a 5-second connect
and 10-second total timeout (the JSON API only), and decoding of each GIF's `original` media URL (inserted into
the draft) and `fixed_width` preview URL (the picker thumbnail). Only `http`/`https` URLs are
kept; a transport failure or rejected key yields no results rather than an error the
composer must handle. Thumbnail and in-message GIF bytes use a 5-second connect timeout
and a 10-second read-stall timeout (no whole-download deadline, so a large GIF on a slow link is
not cut short), capped at 8 MiB. A GIF whose URL is a Mattermost `/api/v4/image?url=` proxy link
is requested with the session credential through `Client::proxied_image`, which follows only
same-origin redirects; a redirect that leaves the origin is returned as `Error::Redirect` and
fetched by `giphy::fetch_bytes` with no credential. Direct Giphy URLs are fetched the same way
without a credential. A failed fetch is not retried in the session.
The key is supplied by the app and is never persisted,
logged or serialized into a Mattermost request. It is not Mattermost traffic, so
it does not use the origin, redirect or `/api/v4` policy above.

## Account persistence boundary

`accounts.rs` owns the validated canonical-origin plus `/users/me` user-ID tuple,
opaque account directories, versioned atomic restrictive-permission non-secret
records, account-local pane/channel drafts and the separate Rust Keychain namespace.
Credential success precedes publishing account metadata. Reject corrupt/unknown
versions or unsafe paths without overwriting prior state; surface deletion/write
failures. `Persistence` is a cloneable Tokio mpsc sender to one dedicated native
thread; concrete commands and oneshot replies serialize all filesystem/Keychain
work off executor workers. Opening validates the registry and root selection;
accepted commands finish even if their reply is abandoned. No generic service
framework or workspace tree is implemented here.

Expose async `accounts`, `restore`, `save`, `checkpoint`, `sign_out`, `selected`
and `select`. Restore fails safely for missing credentials. Save preflights existing
state before replacing a credential, then publishes metadata only after credential
success. Navigation is a deny-unknown-fields `channel_id: Option<String>` plus ordered durable `tabs` (default empty, unique, nonempty, at most 32) preference
with nonempty IDs; drafts retain pane/channel identity. Checkpoint validates both
new and existing records before writing. Drafts/preferences are individually atomic,
not a multi-file transaction: an I/O failure can commit drafts without navigation
and must be surfaced, never reported as a successful checkpoint.

Account entries may record the non-secret login method for presentation; legacy
entries default to unknown. Updating a saved connection must validate the same
server and user identity, then replace credentials through the existing in-place
Keychain save ordering so failed authentication or persistence retains the prior
connection. Deletion uses the existing sign-out workflow and failure reporting.

Selected legacy-token import is copy-only, opt-in and validation-first; existing
Rust entries win. Never enumerate legacy state at startup or infer ownership of
host-only caches/global drafts. Do not persist posts, users, authenticated responses
or media in this scope. The native entry now exercises this boundary through
explicit Remember/Connect saved and checkpointed drafts/navigation. A reserved
submitted pane prevents restored text from authorizing ambiguous resend; complete
pending identity/recovery and workspace trees remain outstanding. Module tests
and UI wiring do not prove native saved-credential parity.

## Thread intents

`Intent::Thread(root)` fetches `GET posts/{root}/thread` for the open channel, validates it like a history
page, keeps only the root and its replies (sorted by time) and publishes `Update::ThreadPosts` with the root,
channel and resolved names; a failure is `Failure::Load`. `Intent::Reply(root, message)` queues a send with
that root id directly. Unlike `Intent::Root` + `Intent::Send` it never reads or clears the one-shot `root`,
so a failed reply cannot leak a root into a later send. Both are standalone sends sharing `Pending`,
reconcile and retry; `Reply` emits `Ready(true)` when it finishes.

## Runnable verification and external gates

`cargo test --locked --offline --lib` exercises origin/redirect/auth/error contracts,
loopback socket lifecycle with controllable time, account isolation/atomic failures,
copy-only import, realistic stripped pending IDs/delayed commits, explicit rejection
retry, offline deletion, threaded history and refresh readiness. Tests use only
synthetic credentials, loopback servers and temporary roots/fake credential stores.
Run strict all-target Clippy and formatting alongside the tests.

Native Keychain CRUD must use a clearly isolated synthetic service. Saves first
request after-first-unlock access control; unsigned builds fail that with
`errSecMissingEntitlement (-34018)`, and only that error falls back to a regular
login-Keychain item (still non-synchronized and OS-encrypted). Never fall back to
plaintext. Protected-Keychain verification still needs authorized
signing/provisioning. Real SAML
requires confirmed bundle/callback identity and an authorized SAML server. Live
load/send/retry/reconnect is a separate acceptance gate; synthetic tests cannot
close it or establish release/macOS-floor readiness.
