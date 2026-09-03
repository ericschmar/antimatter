---
name: antimatter-native-websocket-upgrade-alignment
description: Compare and align Antimatter's native Mattermost WebSocket HTTP upgrade with its former Bun implementation.
---

# Native Mattermost WebSocket Upgrade Alignment

Use this when a native `URLSessionWebSocketTask` fails to connect but the former Bun client worked.

## Investigation

1. Inspect the old Bun socket construction in the JavaScript history. The established connection path converts the configured HTTP(S) server URL to WS(S), sets `/api/v4/websocket`, clears the query, and invokes `new WebSocket(url.toString())` with no options.
2. This means Bun performs a bare RFC 6455 upgrade: no application `Authorization` header and no explicit `Origin` header. The app sends Mattermost's `authentication_challenge` only in the `open` event.
3. Inspect `Sources/AntimatterFoundation/MattermostWebSocket.swift`. Keep native upgrade behavior structurally equivalent: create `URLSessionWebSocketTask` with an unmodified `URLRequest` for the calculated endpoint, then send `authentication_challenge` after resuming.
4. Do not add a forged `Origin` header. It is security-sensitive and is not part of the working Bun behavior.

## Minimal implementation

- Centralize bare request construction in `MattermostWebSocket.upgradeRequest(for:)` when a request assertion needs a test seam.
- Construct the task with `session.webSocketTask(with: Self.upgradeRequest(for: serverURL))`.
- Preserve the existing challenge send, serialized lifecycle guards, heartbeat, and reconnect behavior.

## Verification

- In `NativeTests/AntimatterFoundationTests/MattermostAPIClientTests.swift`, assert the request endpoint is `wss://<host>/api/v4/websocket` and `Authorization` is absent.
- Run:

```sh
swift test --filter 'AntimatterFoundationTests.MattermostAPIClientTests'
swift test
git diff --check
```

## Evidence note

At the Mattermost endpoint tested on 2026-09-03, raw HTTP/1.1 upgrades returned `101 Switching Protocols` both with no `Authorization` header and with a deliberately invalid bearer value. A local Bun 1.3.6 upgrade capture also showed only RFC 6455 headers (`Connection`, `Host`, `Sec-WebSocket-*`, and `Upgrade`)—no application authorization or `Origin`. Therefore header removal aligns implementations, but does not by itself prove it resolves every transport-level `NSPOSIXErrorDomain Code=57` failure.