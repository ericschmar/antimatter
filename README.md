# Antimatter

Antimatter is a native desktop client for [Mattermost](https://mattermost.com) servers, written in Rust on the [Rune](https://github.com/anomalyco/rune) UI runtime. It is focused on conversations: channels, direct and group messages, threads, search and files, in a compact native window rather than an embedded web application.

The project is under active development and is macOS first. Its legacy Swift product has been removed; the last version is preserved in git history at commit `11e1499`.

## Status

Antimatter is **not yet a full Mattermost client** and is not a validated release. Native execution supports:

- Sign-in with a personal access token or username/password, with opt-in saved accounts.
- Channel and latest-history loading, sending, conservative delivery checks and WebSocket reconnect refresh.
- Durable drafts and navigation that autosave and checkpoint before transitions.

Outstanding work includes native Keychain storage (blocked on signing entitlements), browser callback delivery and SAML validation, full pending-send recovery, legacy import, and live validation against servers. A disk failure or crash before autosave commits can lose the latest edit. Headless and scripted scenes use synthetic data only, and real sessions do not allow export or tracing.

[SPEC.md](SPEC.md) defines the approved replacement boundary and the status of each contract.

## Features

- **Conversations:** channels, direct and group messages, unread and viewed state, and sidebar grouping.
- **Real time:** post, reaction and status updates over the Mattermost WebSocket API, and a typing indicator.
- **Threads:** a thread panel with previews and reply composition.
- **Composer:** Markdown with rich rendering, file attachments, emoji and GIF pickers (GIF search needs a Giphy key).
- **Files:** a channel files panel and authenticated image loading.
- **Search:** message search with thread-scope, channel, sender, date, file-type and pinned/saved filters.
- **Polls:** poll cards in the timeline with clickable vote options.
- **Tabs:** tabbed conversations; split panes are a deliberate non-goal.
- **Notifications:** per-channel notification levels (default, all, mentions, muted) synced with the server.
- **Settings:** a singleton native settings window.

## Mattermost Name And API Notice

Mattermost is a trademark of Mattermost, Inc. Antimatter is an independent project and is not affiliated with, endorsed by, sponsored by, or certified by Mattermost, Inc.

This project uses Mattermost's publicly available, open source API behavior and API definitions to interoperate with Mattermost-compatible servers. Use of the Mattermost name in this repository is descriptive only, so users and contributors can understand what service the client connects to.

## Requirements

- Rust 1.99.1, installed through [rustup](https://rustup.rs). `rust-toolchain.toml` pins the version.
- macOS build tools and a GPU for rendering.
- Python 3 (standard library only) for the headless self-check.
- [Task](https://taskfile.dev) to run the project tasks (optional; each task wraps a `cargo` or `python3` command).

macOS 14+ is the intended platform, but it is not a validated Rune runtime minimum. Bun is used only for development-time spec tooling and is not part of the application runtime.

## Getting Started

```sh
task fetch      # once: fetch crates so the rest run offline
task run        # native window, no hot reload
task dev        # native window with the debug dev sign-in environment
task verify     # format, clippy, tests, headless checks and UI lint
```

Run `task` on its own to list every task. `task dev:snap` re-renders `build/ui/hot.png` on each change, with no window, and needs Dioxus CLI 0.7.10 (`task hot:install`).

Without Task, the same checks run directly:

```sh
cargo run --locked                       # native window
cargo test --workspace --locked --offline
python3 scripts/rune-headless.py         # scripted interaction and accessibility checks
```

The headless checks write PNG and JSON evidence to `build/rune-headless/`. Automated checks do not replace looking at the renders, so inspect the PNGs after UI changes. `task ui:lint` renders every scene at four window sizes into `build/ui/`. `task precommit` runs `task verify` and then deletes the generated artifacts.

To render a single headless frame:

```sh
mkdir -p build/rune-headless
cargo run --locked --offline -- --at 1 --tree build/rune-headless/default.json --snap build/rune-headless/default.png
```

Add `--scene conversation-proof --size 640x640` for a synthetic conversation. `cargo run --locked -- --real-account` starts an interactive session and rejects headless export. HTTP servers are used only with the explicit `--dev-http` option.

### Native bundle

```sh
python3 scripts/rune-native.py          # build build/rune-native/Antimatter.app
python3 scripts/rune-native.py --check  # verify an existing bundle
```

The bundle is unsigned and unregistered. It is checked for metadata and binary only; it is not launched or signed.

## Local Credentials

For local development, Antimatter can read Mattermost credentials from `.env.local`:

```sh
MATTERMOST_SERVER_URL=https://mattermost.example.com
MATTERMOST_PAT=your-personal-access-token
GIPHY_API_KEY=your-giphy-api-key
```

`MATTERMOST_URL` is accepted as a legacy alias for `MATTERMOST_SERVER_URL`. You can also enter credentials on the sign-in screen. `GIPHY_API_KEY` is read at runtime and is embedded into packaged builds when it is set in the build environment. `.env` and `.env.local` are git-ignored.

## Authentication

Antimatter supports three sign-in methods:

- **Token:** a personal access token.
- **Password:** Mattermost username or email and password.
- **SSO:** SAML through the default browser. Antimatter opens the server's `/login/sso/saml` URL with a generated desktop token, and exchanges the server token returned by Mattermost's desktop callback for a normal API bearer token.

## Project Layout

```txt
crates/antimatter-services/   Mattermost REST and WebSocket, accounts, conversations (no UI dependencies)
crates/antimatter-theme/      Antimatter design tokens as a rune-kit Kit (4 themes)
crates/antimatter-app/        Rune application: state, session, sign-in, workspace, settings, scenes
scripts/                      Headless checks, UI lint, native bundle and icon tooling
docs/                         Design records and the replacement contracts
```

Each crate has a `SPEC.md` that records its contracts. The root [SPEC.md](SPEC.md) indexes them.

## Versioning And Releases

The crate version is set in `Cargo.toml` (`[workspace.package] version`). The native bundle version is set in `scripts/rune-native.py` (`CFBundleShortVersionString` and `CFBundleVersion`). Keep the two aligned before tagging.

Release tags use `v*.*.*`:

```sh
git tag v0.0.1
git push origin v0.0.1
```

Pushing a tag runs the release workflow. It runs the locked tests, builds and checks the unsigned native bundle, uploads it as a workflow artifact and attaches it to the GitHub release. Signing, notarization and Keychain and SAML release checks are not automated yet; see [docs/swiftui-recreation/09-testing-accessibility-performance-and-release.md](docs/swiftui-recreation/09-testing-accessibility-performance-and-release.md).

## CI/CD

GitHub Actions workflows live in `.github/workflows/`:

- `ci.yml` runs on pull requests and on pushes to `main` and `master`, on the pinned Rust toolchain. It runs locked `cargo fmt`, clippy and tests, the headless checks, and UI lint, and uploads the rendered evidence. UI lint is `continue-on-error` in CI while its layout findings are being resolved; `task verify` still treats it as a failure.
- `release.yml` runs on SemVer tags and manual dispatch. It runs the locked tests, builds and checks the unsigned native bundle, and publishes it to tagged releases.

## Contributing

- Read the spec for the area you change. Behaviour that a spec documents is a contract; update the spec in the same change when the contract changes.
- Run `task verify` before proposing a change, and inspect the rendered PNGs for UI work.
- Keep changes focused, and do not commit build artifacts.

## Notes

- `.DS_Store` files are git-ignored.
- WebRTC voice and video work is exploratory; see [WEBRTC_IMPLEMENTATION_GUIDE.md](WEBRTC_IMPLEMENTATION_GUIDE.md).
