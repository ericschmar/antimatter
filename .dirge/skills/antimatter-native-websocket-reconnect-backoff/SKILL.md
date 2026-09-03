---
name: antimatter-native-websocket-reconnect-backoff
description: Diagnose NSURLSession WebSocket POSIX 57 errors in Antimatter's native Mattermost client and prevent rapid reconnect loops after server resets.
---

# Native WebSocket reconnect backoff

Use this workflow when Console shows `NSPOSIXErrorDomain Code=57 "Socket is not connected"` for `MattermostWebSocket`.

1. Read `Sources/AntimatterFoundation/MattermostWebSocket.swift` and trace `connect`, `receiveLoop`, `sendHeartbeat`, `scheduleReconnect`, and `disconnect` before changing anything.
2. Distinguish normal server/proxy TCP resets from client lifecycle races. POSIX 57 accompanied by TCP `RST` while a socket is closing indicates the peer/network closed the transport; eliminate tight client retry loops rather than attempting to suppress OS networking diagnostics.
3. Probe the real endpoint with an RFC 6455 upgrade request before attributing POSIX 57 to the client. If the response body says `URL Blocked because of CORS`, the server rejected the HTTP upgrade before WebSocket authentication. Test without `Origin` and with the configured server origin. If both are rejected, this is a Mattermost `ServiceSettings.AllowCorsFrom` deployment defect; do not guess or fabricate an origin in the native client.
4. Ensure `reconnectAttempt` resets only after the client receives a frame on the newly established socket. Do not reset it merely after `resume()` or an authentication send succeeds: a server reset before its first response would otherwise retry every second indefinitely.
5. Keep reconnection serialized with `task == nil` and `reconnectTask == nil` guards. Use bounded exponential delays (1s, 2s, 4s, ..., max 30s).
5. Expose the pure delay calculation as internal static code only if a package test needs to verify it, and use `@testable import AntimatterFoundation` in the test target because ordinary imports cannot access internal members. Add the test in `NativeTests/AntimatterFoundationTests/MattermostAPIClientTests.swift`.
6. If the delay helper returns `Duration`, pass it directly to `Task.sleep(for:)`; wrapping it in `.seconds(delay)` does not compile because `.seconds` accepts a numeric value, not a `Duration`.

## Verification

```bash
swift test
```

Do not treat a real server-side reset as proof that the client must not reconnect; reconnect with bounded backoff is the intended behavior.
