# Testing, Accessibility, Performance, and Release

## Test strategy

- Unit tests: URL normalization, REST error decoding, Codable fixtures, workspace-tree validation, migration, unread rules, optimistic reconciliation, mention parsing, polling/voting rules.
- Network tests: custom `URLProtocol` for REST and a controllable websocket protocol/fake event stream.
- UI tests: auth states, sidebar selection, tab close/restore, message send/retry, keyboard palette, mention keyboard selection, attachment flow, theme switching.
- Manual server matrix: PAT/password/SAML, channels/DMs/groups, a server with custom emoji, slow network, offline/reconnect, large files, long messages, light/dark appearance.

## Accessibility

- Every icon action has an explicit label and keyboard equivalent where applicable.
- Preserve native focus rings with theme-aware tint; do not rely on hover-only actions for essential behavior.
- Use VoiceOver labels for unread/mention/status and announce send failures/connection transitions.
- Ensure logical reading order: sidebar, active tab strip, header, timeline, composer.
- Respect Reduce Motion and system font scaling; do not make text size a purely visual transform that breaks layout.

## Performance budgets

- Channel selection should render cached content immediately and begin history work without blocking the main actor.
- Maintain smooth scrolling with 60+ visible message scenarios; profile 500+ loaded posts and attachment-heavy timelines.
- Decode images off main actor and reserve image frame space from file dimensions when available.
- Debounce search 180 ms; cancel stale requests.
- Instrument durations without recording message content, URLs with sensitive query strings, or credentials.

## Release and privacy

- Use Developer ID signing, hardened runtime, notarization, and a documented entitlement set.
- Request camera/microphone permissions only when the experimental call phase reaches them.
- Ship `PrivacyInfo.xcprivacy` and clear third-party notices, including any copied Nibware source.
- CI must run formatting/linting, build, unit tests, UI smoke tests, and a signed archive validation. A release checklist confirms Keychain behavior, SSO callback registration, websocket reconnect, notifications, and update path.

## Cargo CI and release gates (issue #5)

Supersedes the Bun-based CI/release workflows previously described here and in the README. Product build and test paths are Cargo-only; Bun is not used by any workflow.

- CI (`.github/workflows/ci.yml`, macOS, pinned Rust 1.99.1): `cargo fetch --locked`, `cargo fmt --all --check`, `cargo clippy --workspace --locked --offline --all-targets -- -D warnings`, `cargo test --workspace --locked --offline`, `python3 scripts/ui-lint.py --self-test`, `python3 scripts/rune-headless.py`, and `python3 scripts/ui-lint.py`. Rendered headless and UI PNG/JSON evidence is uploaded as an artifact. It contains only synthetic scenes and no credentials.
- Release (`.github/workflows/release.yml`, tags `v*.*.*` and manual dispatch): locked tests, `python3 scripts/rune-native.py` to build the unsigned, unregistered bundle, `--check` to verify it, and a zip of `build/rune-native/Antimatter.app` attached to the release. No signing, notarization, or credential is used in CI.
- Not yet automated and blocked on native or credential access: Developer ID signing, hardened runtime, notarization, Keychain CRUD with signing entitlements, SAML callback registration, websocket reconnect against a live server, notifications, VoiceOver/IME accessibility, settings/multiwindow behavior, macOS 14+ minimum validation, and the `PrivacyInfo.xcprivacy` manifest. Each must be verified on hardware before the migration is called complete. Screenshots alone are not sufficient.
- Swift/Xcode product files (`Sources/`, `NativeTests/`, `Antimatter.xcodeproj`, `Package.swift`, `Xcode/`) are retained as reference material until removal is explicitly authorized and their retention plan is agreed; no deletion is part of this gate.
