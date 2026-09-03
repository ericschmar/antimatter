---
name: antimatter-native-websocket-upgrade-alignment
description: Diagnose and align Antimatter native Mattermost WebSocket connections with current Mattermost server protocol behavior.
---

# Native Mattermost WebSocket Upgrade Alignment

Use this when a native `URLSessionWebSocketTask` fails while connecting to Mattermost.

## Investigation

1. Inspect the JavaScript implementation as historical evidence, but validate against the deployed Mattermost version.
2. Mattermost v11 initializes the WebSocket connection from the authenticated HTTP-upgrade request context. Construct the endpoint request with the session authorization credential.
3. Keep the post-open `authentication_challenge` for compatibility. Mattermost accepts it when the upgrade has no session and ignores the duplicate when the upgrade is authenticated.
4. Do not forge an `Origin` header. It is security-sensitive and unrelated to credential propagation.

## Mattermost v11 frame rule

`URLSessionWebSocketTask.Message.data` sends a binary WebSocket frame even if it contains UTF-8 JSON. Mattermost v11 closes an unauthenticated connection whose first inbound frame is binary; it expects a text JSON authentication challenge.

- Encode every JSON action as a text frame using `.string(String(decoding: jsonData, as: UTF8.self))`.
- Apply this consistently to authentication, heartbeat pings, and generic actions such as typing.
- Centralize the conversion in `MattermostWebSocket.textMessage(for:)` and add a regression test asserting the helper produces `.string`.

## Verification

```sh
swift test --filter 'AntimatterFoundationTests.MattermostAPIClientTests'
swift test
git diff --check
```

A `101 Switching Protocols` response only proves the HTTP upgrade succeeded. If the native socket later fails with POSIX 57, distinguish server rejection before changing retries or headers: inspect the first received frame or Mattermost/nginx logs.