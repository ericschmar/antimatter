# Native Architecture and Data Model

## Approved Rust replacement contract

The user approved this revised issue #3 contract on 2026-11-10. It replaces this
document's Swift module/Observation, actor, Codable and UserDefaults/SwiftData
implementation prescriptions for the Rust product. All application/service code
is rewritten in Rust; existing product/workspace contracts remain in force.

- Keep one Cargo application. Use small Rust modules for Mattermost wire models,
  REST/auth/WebSocket, account persistence, and macOS adapters; do not create a
  feature-crate hierarchy or a generic service framework.
- Rune UI state owns active/saved account selection and presentation. Background
  networking, decoding and durable writes publish small updates through Rune's
  `AppHandle::update`. Views emit intents, not HTTP requests. Each operation
  carries account identity and a session generation; switching/signing out
  cancels work and rejects late completions from the previous generation.
- Rewrite all application/service logic in Rust; no Swift source reuse or Swift
  FFI. Use Tokio for background execution, reqwest for REST and
  tokio-tungstenite for WebSocket, with serde/serde_json wire models. Do not use
  NSURLSession or port the Swift service architecture through Objective-C.
  Native bindings are limited to required macOS OS integration (Keychain and
  system-browser authentication), authored in Rust. Dependency versions/features
  must be checked against the pinned toolchain before implementation; HTTP and
  WebSocket share a consistent validated TLS policy. Use one serialized worker
  for account persistence/state transitions; no blocking I/O or decoding on the
  UI thread. Blocking filesystem/Keychain work stays off Tokio executor workers.
- Account identity is the tuple (canonical server origin, validated `/users/me`
  user ID). Normalize scheme/hostname/default port and trailing root slash;
  default missing scheme to HTTPS. Reject credentials, query, fragment and
  non-root paths rather than silently discarding a deployment prefix. Different
  ports or schemes remain distinct; same-server users remain distinct. HTTPS is
  mandatory unless development HTTP is explicitly enabled. Files use an opaque
  local account ID whose versioned registry records the tuple; never derive
  filenames from hosts or user-supplied IDs.
- Keep tokens out of serializable/UI-exportable state. Use a separate Keychain
  service `com.antimatter.desktop.mattermost.rust.v1`, keyed by canonical tuple,
  with desktop after-first-unlock accessibility and non-synchronizing items.
  Update existing items in place rather than delete-then-add. Publish saved
  account metadata only after credential storage succeeds; surface failures and
  retain recoverable prior state. Never fall back to plaintext credentials.
- Version non-secret registry/preferences and account-local drafts/navigation/
  workspace records under `Application Support/Antimatter/Rust/v1`. Persist via
  restrictive-permission same-directory temporary files, sync and atomic rename;
  serialize writers and retain the last valid record on failure. Reject unknown
  versions without overwriting them. Validate workspace structure as specified
  below. Drafts belong to account plus pane/channel, not channel ID alone.
- Do not persist posts, users, authenticated HTTP responses or attachments in
  #3. Keep service data in account-local memory; media caching needs an explicit
  later policy. This reconciles the legacy host-only post cache with this
  document's existing cache restriction. Clearing/reloading is not data migration.
- Switching accounts clears rendered old-account content before new loads,
  including Settings consumers. Sign-out cancels tasks/socket and removes only
  the selected Rust account's credential and durable state; deletion failure is
  visible/retryable and never implies successful credential removal. It does not
  modify Swift state or another Rust account. Singleton Settings remains #4.

### Conversation vertical-slice checkpoint

The Rune native entry now connects fresh PAT/password **session-only** accounts,
loads channel navigation/latest history, sends and checks pending delivery, and
refreshes after socket authentication/reconnect. Tokens remain service-owned;
no credential or draft persistence is implied by this entry. Disconnect cancels
and clears this in-memory session; it is not the durable account sign-out action.
The UI warns that disconnect discards session-only drafts/pending state.

This minimal slice serializes channel loads and blocks channel changes while
loading or while draft/pending text exists. Session cancellation drops the whole
service future; generation checks reject queued stale UI completions. Concurrent
pane loads/query cancellation and durable saved-selection/draft orchestration
remain outstanding, not superseded. Refresh replaces the validated latest-page
snapshot, including posts deleted while offline, before marking it ready.
Real sessions forbid headless exports and native tracing. Synthetic scenes never
start services or read account storage.

### Proposed non-destructive legacy migration

Default to fresh sign-in. Do not enumerate/read legacy Keychain items, preferences
or cache files at startup. An explicit "Import saved sign-ins" action may read
only user-selected legacy preference domains and their exact listed server-URL
Keychain entries. Domain/bundle identity must be established, not guessed from a
Cargo process. Normalize/validate each server and validate the token with
`/users/me` before copying it into the new account namespace. A denied Keychain
read, offline server or rejected token skips that entry with a safe error and no
source mutation. Existing Rust entries win: no silent credential overwrite.
Repeat import is idempotent; legacy entries/preferences/files are never removed.

Host-only caches and globally keyed drafts/tabs cannot prove account ownership.
Do not automatically import them, even if only one server is saved. Leave them
untouched for explicit user-directed recovery/export in #4; warn that legacy
workspace/drafts are not restored into the Rust app. Global appearance settings
also remain untouched; any import needs an explicit allowlist under #4.

### Verification contract

Use synthetic temporary roots and a fake credential store for identity/isolation,
failed writes, unknown/corrupt versions, idempotent import, denied/offline import,
source preservation and late-result rejection tests. Native Keychain CRUD uses
only a clearly isolated synthetic service; never test against real saved items.
Keep one focused runnable check for each non-trivial new boundary, using Cargo's
built-in test harness. No production storage or credentials in headless fixtures.
A live authenticated load/send/retry/reconnect check is separately required by
#3; offline tests cannot close that acceptance gate.

## Modules

- `AntimatterMacApp`: app lifecycle, scenes, commands, deep links, settings scene.
- `Features/Auth`, `Features/Sidebar`, `Features/Workspace`, `Features/Timeline`, `Features/Composer`, `Features/Search`, `Features/Attachments`, `Features/Settings`.
- `Core/Mattermost`: REST client, websocket actor, Codable wire models, error mapping.
- `Core/Persistence`: Keychain credentials, SwiftData/UserDefaults local state, workspace codec.
- `UI`: theme, primitives, AppKit representables, Nibware-adapted source.

## State ownership

Use Swift Observation. `@MainActor @Observable final class AppStore` owns account/session selection, loaded data, presentation routes, and feature stores. Network services are actors. Views emit intent methods to stores; they do not construct API requests.

Maintain normalized dictionaries keyed by server ID for users, teams, channels, posts, members, status, and reactions. `TimelineStore` holds per-channel ordered IDs, cursors, loading state, scroll anchor, and optimistic mutations. `WorkspaceStore` owns pane/tree state. Keep pane state separate from channel server data.

## Codable models

Mirror Mattermost v4 JSON with Swift `CodingKeys` for snake case. Essential fields are listed in `appendix/parity-matrix.md`: users, teams, channels (`O/P/D/G`), members, posts, files, reactions, poll props, and status.

Use local models for:

- `AppPreferences`: theme, font, profile picture visibility, own-post marker, notification settings, composer selection.
- `LocalNavigationState`: favorites, archives, channel emoji map, channel order, collapsed sections.
- `WorkspaceSnapshot(version: 1)`: durable panes, active pane, split tree ratios, selected tab per group.
- `PaneState`: draft, reply/edit target, scroll anchor, composer height.

## Persistence

- Keychain: bearer token and any SSO/session secret, keyed by normalized server URL plus account ID.
- `UserDefaults` or SwiftData: non-secret preferences, local navigation state, workspace snapshot, last team/channel.
- Application Support cache: images/attachment thumbnails only when cache policy is defined; never serialize authorization headers or tokens.
- Version every persisted record and migrate explicitly. If a workspace snapshot references unknown channels or has invalid tree ratios/leaves, reset to a safe single/empty workspace.

## Concurrency and lifecycle

- All REST/websocket decoding occurs outside `MainActor`.
- Apply store mutations on `MainActor` in small batches.
- Cancel history/search/image work when the owning pane closes or query changes.
- On sign-out: close websocket, cancel tasks, remove Keychain secret, clear account-specific cache/state, and reset UI.
