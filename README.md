# Antimatter

Antimatter is a small desktop client for Mattermost-compatible servers. It is built with ElectroBun, Bun, React, and TypeScript, with the native Bun process owning Mattermost API calls, file uploads, WebSocket connections, notifications, menus, and SSO handoff.

The goal is a focused desktop experience: channels, direct messages, search, reactions, uploads, markdown composition, notifications, and a compact native shell without embedding the full Mattermost web application.

## Status

This project is under active development. It is useful as a lightweight client, but it is not a complete replacement for the official Mattermost desktop app.

## Features

- Connect with a personal access token, username/password, or SSO.
- SAML SSO uses the system browser and Mattermost's desktop-token callback flow so hardware-key authentication can complete outside the embedded app shell.
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

- Bun
- macOS for the current deep-link SSO flow
- A Mattermost-compatible server

ElectroBun's custom URL scheme support is currently macOS-oriented. The app registers `mattermost-dev://` for the Mattermost desktop login callback path.

## Getting Started

Install dependencies:

```sh
bun install
```

Start the development app:

```sh
bun run dev
```

Run without file watching:

```sh
bun run start
```

Typecheck and test:

```sh
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
MATTERMOST_URL=https://mattermost.example.com
MATTERMOST_PAT=your-personal-access-token
```

You can also enter credentials from the login screen.

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
bun run typecheck    # TypeScript no-emit check
bun test             # unit tests
bun run build:canary # package a canary build
```

## Notes

- `.env` and `.env.local` are ignored.
- `.DS_Store` files are ignored.
- WebRTC voice/video work is still exploratory.

