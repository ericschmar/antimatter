# Mattermost API, WebSocket, and Authentication

## Approved Rust replacement contract

The user approved this revised issue #3 contract on 2026-11-10. It replaces the
REST/WebSocket actors, Codable and URLProtocol implementation prescriptions with
Rust-native services and Cargo synthetic checks. Required endpoint groups, page
sizes, SAML browser behavior and security controls below remain authoritative.
Account/storage ownership is in document 04's approved replacement contract.

- Centralize canonical origin validation and `/api/v4` endpoint construction.
  Never attach credentials to arbitrary absolute URLs. Authenticated media must
  match scheme, canonical host and effective port. Reject redirects for API,
  login, token exchange and authenticated media rather than forwarding secrets;
  browser SAML redirects remain managed by the system authentication session.
  Use account-local reqwest clients and tokio-tungstenite sockets on Tokio;
  disable redirect following and cookie persistence and do not enable disk HTTP
  caches. No NSURLSession or Swift service reuse. Normal TLS validation is never
  bypassed; select compatible Rust TLS features for both transports.
- Use serde wire models with snake-case field mapping and structured errors
  preserving HTTP status and Mattermost error ID/message. Never blindly expose
  server bodies/error strings in logs or accessible UI; render safe contextual
  errors without request URLs, credentials or raw bodies. No automatic retry of
  a possibly successful write. Preserve draft/pending-send identity on ambiguous
  failure and reconcile before explicit retry to avoid duplicate posts. Ordinary
  Mattermost history does not persist `pending_post_id`; its bounded server-side
  cache is not durable idempotency. History absence must never authorize resend
  after transport/decode/timeout/5xx uncertainty. Retain unresolved pending text;
  the check-delivery action may acknowledge a matching trusted response/event,
  but only a definitive client rejection (4xx except 408) permits explicit resend.
- All three sign-in methods validate and decode `/users/me` before storing a
  token. Password and SAML exchange capture the `Token` response header then
  perform that validation; PAT does the same validation directly. Drop/clear
  password input after submission, including failures. Use Rune secure edits for
  PAT/password, no plaintext Debug/serialization, and no secret-bearing headless
  trees/screenshots. Real-account mode must reject tree/screenshot export rather
  than rely only on field masking.
- Keep SAML in a Rust macOS adapter for `ASWebAuthenticationSession`, retaining
  the session and presentation provider and starting/cancelling on the UI thread.
  Use a cryptographically random per-attempt client token, validate callback
  scheme/shape and exactly one matching `client_token` plus one nonempty
  `server_token`, consume once and reject stale/cancelled callbacks. Exchange at
  `/api/v4/users/login/desktop_token`, then validate `/users/me`. Preserve the
  existing registered `mattermost-dev` callback for compatibility; actual bundle
  registration and native callback checks are required, not implied by Cargo.
  The user authorized reusing the actual Swift bundle identity
  `antimatter.ericschmar.dev` on 2026-11-10. The Rust helper builds a separate
  unsigned/unregistered bundle under ignored build output, without modifying
  Swift/Xcode artifacts. Browser start validates the running main-bundle identity
  and callback declaration and retains its key/main window. No embedded-browser
  fallback in #3.
- Isolated native Keychain CRUD uses a unique synthetic service and synthetic
  values only. The native check currently fails at first save with
  `errSecMissingEntitlement (-34018)`; after-first-unlock protection is not
  weakened to bypass this. Authorized signing/provisioning and explicit protected
  Keychain selection require verification before claiming saved-credential parity.
  Ad-hoc signing is not evidence of required entitlement authorization.
- WebSocket emits idle/connecting/connected/disconnected/error. Connection means
  a matching successful auth reply or `hello`, not merely socket creation/send.
  One connection owns its receive/heartbeat/reconnect tasks. Use monotonically
  increasing action sequences, ping every 25 seconds and enforce a missed-reply
  deadline. Reconnect with `min(30 s, 1 s × 2^attempt)`, reset after authenticated
  connection, never reconnect after explicit sign-out/cancellation. Authentication
  rejection suspends reconnect and requires reauthentication. Ignore late frames
  from replaced session generations; decode listed events without assuming nested
  data is always an object (Mattermost also sends JSON strings).
- After reconnect, refresh visible history/navigation/unread state before claiming
  consistency; de-duplicate by server post ID and pending-send identity. Cancel
  pane/query work as specified in document 04. Implement the load/send/retry/
  reconnect vertical slice first; required endpoint groups remain #3 acceptance,
  while their full workspace UI belongs to #4 and calls remain deferred.

### Verification contract

Cargo checks use a synthetic loopback server enabled only by an explicit test/
local-development HTTP policy. Cover methods/headers/pagination, structured and
malformed errors, missing login token, `/users/me` validation, origin/redirect
rejection, callback spoofing/duplicates/cancellation, WebSocket authentication,
heartbeat timeout/backoff/refresh and no-reconnect-on-sign-out. Use a controllable
clock for lifecycle tests, not real 30-second sleeps. Test ambiguous-send retry
without silently duplicating a post. Secure-field synthetic headless checks may
use only fake values and must assert redaction.

Native Keychain/browser-session checks and one live-server conversation that
loads/sends/retries/reconnects are additional gates. SAML acceptance specifically
requires an SAML-enabled server and real callback delivery. Record missing access
or bundle prerequisites in GitHub; do not claim offline fixtures prove auth or
service parity.

## REST transport

`MattermostClient` is an actor around `URLSession`. Normalize server URLs by trimming whitespace/trailing slashes and adding `https://` when omitted. All normal paths are relative to `/api/v4`; authenticate with `Authorization: Bearer <token>`. Decode structured error `message`/`error`, preserve HTTP status, and never log tokens or response bodies containing credentials.

## Required endpoint groups

- Session/bootstrap: `/users/me`, `/users/me/teams`, users by IDs/usernames/status IDs.
- Navigation: paged user/team channels, channel detail/members, channel search, create public/private channel, direct/group channel, member add, channel view.
- Posts: newest channel posts, posts before cursor, thread, post search, create/update/delete/patch, custom poll post and props patch.
- Files: multipart upload to `/files`, authenticated file/preview retrieval, attachment open/download.
- Reactions: fetch/add/remove.

Use 60 posts per history page initially and 200 per channel-navigation page, matching the current behavior. Keep endpoint methods individually testable with `URLProtocol` fixtures.

## WebSocket

Use `URLSessionWebSocketTask` to `ws(s)://host/api/v4/websocket`, then send `authentication_challenge` with monotonic sequence and token. Treat successful auth reply or `hello` as connected. Decode at least posted, post-edited/deleted, reaction, typing, status/presence, channel/member, and preference events needed by implemented phases.

Reconnect only when not explicitly signed out: exponential delay `min(30 s, 1 s × 2^attempt)`, reset attempts after authentication. Expose `idle`, `connecting`, `connected`, `disconnected`, `error` to UI. Resume/refresh visible timelines after reconnect because websocket delivery alone is not a full consistency guarantee.

## Auth

- PAT: validate by requesting `/users/me`; store token only after success.
- Password: POST Mattermost login endpoint, capture returned bearer token, discard entered password immediately.
- SAML SSO: use `ASWebAuthenticationSession` with an app-registered callback URL scheme. Start the server’s SAML desktop-token flow, validate callback state/desktop token, exchange for normal bearer credentials, then validate `/users/me`.

Do not use a generic embedded browser as the default. If a contained `WKWebView` is needed for a server-specific callback limitation, constrain navigation to expected origins and keep the implementation behind `SSOCoordinator`.

## Security controls

- HTTPS required except an explicitly enabled development exception.
- Keychain accessibility appropriate to a desktop app; no token in UserDefaults, workspace, notifications, crash reports, or URL query logging.
- Treat Markdown and attachment names as untrusted. Open external links through the system with user intent; sanitize rendered HTML if an HTML-based markdown renderer is chosen.
- Prefer Quick Look/`NSWorkspace` for attachment handling and scope temporary files safely.
