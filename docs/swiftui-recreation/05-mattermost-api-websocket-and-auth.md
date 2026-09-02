# Mattermost API, WebSocket, and Authentication

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
