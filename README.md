# Antimatter

Antimatter is replacing its desktop client with Rust/Rune, macOS first; calls are deferred. Cargo is the primary app development entry. The Rust native app now has a session-only PAT/password conversation slice, **not a full Mattermost client**. Existing Swift files and the older documentation below remain reference material; no source removal is authorized.

The goal is a focused desktop experience: channels, direct messages, search, reactions, uploads, markdown composition, notifications, and a compact native shell without embedding the full Mattermost web application.

## Status

This project is under active development. Native execution offers fresh PAT/password sign-in, channel/latest-history loading, send, conservative delivery checks and socket reconnect refresh. Credentials and drafts are not saved by this entry; disconnect discards session-only state. Native Keychain/SAML, saved-account UI and live-server validation remain outstanding. Headless execution retains the accessible Lights bootstrap and synthetic scenes; real sessions forbid export/tracing. See [SPEC.md](SPEC.md) for the approved replacement boundary.

## Features

- Connect with a personal access token, username/password, or SSO.
- SAML SSO uses Mattermost's desktop-token callback flow in a contained login window. This lets the app capture its callback consistently across native and bundled-CEF renderers.
- Real-time post, reaction, and status updates over the Mattermost WebSocket API.
- Channel, group message, and direct message navigation.
- Message search, user search, public channel search, and command palette access.
- Markdown message rendering and rich message composition.
- File upload and authenticated image loading.
- Emoji reactions and custom channel emoji labels.
- Desktop notifications and a native settings window.

## Mattermost Name And API Notice

Mattermost is a trademark of Mattermost, Inc. Antimatter is an independent project and is not affiliated with, endorsed by, sponsored by, or certified by Mattermost, Inc.

This project uses Mattermost's publicly available, open source API behavior and API definitions to interoperate with Mattermost-compatible servers. Use of the Mattermost name in this repository is descriptive only, so users and contributors can understand what service the client connects to.

## Requirements

- Rust 1.99.1 via rustup (`rust-toolchain.toml` pins it), macOS build tools and a GPU for rendering.
- Python 3 (standard library only) for the headless self-check.

macOS 14+ is legacy product intent, not a validated Rune runtime minimum.
Bun is development-only spec tooling, not the app runtime.

## Getting Started

```sh
cargo fetch
cargo run --locked
cargo check --locked
cargo test --locked
python3 scripts/rune-headless.py
```

After the initial fetch, the self-check uses `cargo run --locked --offline` to
render default and scripted-tap states and assert tree accessibility, visible
labels and PNG dimensions. Repeat the Python command to check offline execution.
Visually inspect both `build/rune-headless/default.png` and
`build/rune-headless/tapped.png`; JSON trees and the synthetic tap script are
alongside them. Automated metadata checks alone are not visual proof.

For a single default headless render:

```sh
mkdir -p build/rune-headless
cargo run --locked --offline -- --at 1 --tree build/rune-headless/default.json --snap build/rune-headless/default.png
```

For a synthetic conversation render, add `--scene conversation-proof --size 640x640`.
Use `cargo run --locked -- --real-account` for an interactive session; this flag
explicitly rejects headless export. HTTP requires the explicit `--dev-http` option.
The remaining feature documentation describes legacy functionality, not full
Rust parity or validated release readiness.

## Profiling UI Responsiveness

Enable the renderer metrics in the app's DevTools console before reproducing a
slow interaction:

```js
localStorage.setItem("mm-clone:perf", "1");
location.reload();
```

Filter the console for `[perf]`. The logs distinguish:

- `clickToFirstTimelinePaint`: elapsed time from selecting a channel to its
  timeline being scheduled for paint.
- `channelHistoryCacheHit` / `channelHistoryCacheMiss`, `historyFetchStart`,
  and `historyFetchEnd`: whether a channel wait is local cache or history
  loading.
- `apiRequest` and `historyWorkerRpc`: per-request duration, method, normalized
  route, transport, and success/error outcome. `historyWorkerRpc` covers the
  history worker's requests, which bypass the renderer API client.
- `render counts`: aggregate React rendering churn every 1.5 seconds.
- `longTask`: renderer main-thread work over the browser's long-task threshold.
  WebKit does not expose this performance API, so its absence is expected in
  the current ElectroBun build; use the DevTools performance recording there.

Disable the instrumentation after profiling with
`localStorage.removeItem("mm-clone:perf"); location.reload()`. The metrics are
off by default and do not record message content or authentication tokens.

Typecheck and test:

```sh
bun run version:check
bun run typecheck
bun test
```

Build the canary app:

```sh
bun run build:canary
```

## Local Credentials

For local development, Antimatter can read Mattermost credentials from `.env.local`:

```sh
MATTERMOST_SERVER_URL=https://mattermost.example.com
MATTERMOST_PAT=your-personal-access-token
GIPHY_API_KEY=your-giphy-api-key
```

`MATTERMOST_URL` is also accepted as a legacy alias for `MATTERMOST_SERVER_URL`.

You can also enter credentials from the login screen.

`GIPHY_API_KEY` is read at runtime for local development and embedded into
packaged builds when it is present in the build environment.

## Authentication

Antimatter supports three login paths:

- `Token`: personal access token.
- `Password`: Mattermost username/email and password login.
- `SSO`: SAML via the default browser.

The SSO flow opens the server's `/login/sso/saml` URL with a generated desktop token. After the browser completes login, Mattermost redirects through its desktop callback flow, and Antimatter exchanges the returned server token for a normal API bearer token.

## Project Layout

```txt
src/bun/          ElectroBun main process: API proxy, SSO, websocket, menus
src/mainview/     React desktop UI
src/childview/    Settings window UI
src/shared/       Shared RPC types
```

The renderer does not call Mattermost directly for normal app traffic. It sends typed RPC requests to the Bun process, and the Bun process performs the authenticated Mattermost API and WebSocket work.

## Useful Scripts

```sh
bun run dev          # start ElectroBun with watch mode
bun run start        # start ElectroBun
bun run build        # package a production build
bun run version:bump -- patch # bump package.json and electrobun.config.ts together
bun run version:check # validate SemVer and app/package version alignment
bun run typecheck    # TypeScript no-emit check
bun test             # unit tests
bun run build:canary # package a canary build
```

## Versioning And Releases

Antimatter uses SemVer for releases. Use the bump script so `package.json` and `electrobun.config.ts` stay aligned:

```sh
bun run version:bump -- patch
bun run version:bump -- minor
bun run version:bump -- prerelease --preid alpha
bun run version:bump -- 1.2.3
```

Before tagging a release, validate the versions:

```sh
bun run version:check
```

Release tags must match the package version exactly:

```sh
git tag v1.2.3
git push origin v1.2.3
```

Pushing a `v*.*.*` tag runs the release workflow, builds the macOS app, uploads the build artifact, and attaches the contents of `artifacts/` to the GitHub release.

## CI/CD

GitHub Actions are configured under `.github/workflows/`:

- `ci.yml`: runs on pull requests and pushes to `main`/`master`; installs dependencies, checks SemVer, typechecks, and runs tests.
- `release.yml`: runs on SemVer tags and manual dispatch; checks SemVer, typechecks, tests, builds, uploads artifacts, and publishes tagged releases.

## Notes

- `.env` and `.env.local` are ignored.
- `.DS_Store` files are ignored.
- WebRTC voice/video work is still exploratory.
