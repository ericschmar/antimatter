---
id: antimatter
type: architecture-design
title: Antimatter immediate Rust replacement boundary
status: draft
references: [antimatter-spec-tooling, antimatter-rust-runtime, antimatter-rust-services]
---

# Antimatter replacement

## Approval and ownership

The user approved **immediate Rust/Rune replacement**, **macOS first**, and
**calls deferred** on 2026-11-10. This supersedes the Swift-first technology and
parallel/staged product migration strategy, not the existing feature contracts.
Bun is development-only spec tooling, not the application runtime. No Swift FFI
or parallel Swift product is intended. Existing source remains reference material
until removal is explicitly authorized and local work is preserved.

This root is **draft** for detailed replacement design. The approved boundary
above and minimal hello bootstrap below are authoritative; they are not blanket approval of new feature semantics,
service architecture, data migration or release readiness. Before implementing
feature-level changes, reconcile and update the applicable owning specification
in that same change. Explicit supersession must name the owning document/section,
the replaced contract, and its replacement; silence does not supersede anything.

## Existing authoritative contracts

Follow these owners rather than duplicating their content. Their SwiftUI/AppKit
and URLSession implementation prescriptions must be translated into approved Rust
contracts before replacement implementation; product, service, security and
settings behavior remain authoritative unless explicitly superseded.

- [Product/parity](docs/swiftui-recreation/01-product-and-parity-scope.md),
  [visual identity](docs/swiftui-recreation/02-visual-system-and-nibware-adaptation.md),
  [flows](docs/swiftui-recreation/03-information-architecture-and-user-flows.md).
- [Architecture/data](docs/swiftui-recreation/04-native-architecture-and-data-model.md),
  [Mattermost API/WebSocket/auth](docs/swiftui-recreation/05-mattermost-api-websocket-and-auth.md).
- [Workspace](docs/swiftui-recreation/06-swiftui-appkit-workspace-design.md),
  [components](docs/swiftui-recreation/07-component-specifications.md),
  [singleton Settings](docs/design/2026-10-08-settings-window-design.md).
- [Roadmap](docs/swiftui-recreation/08-phased-implementation-roadmap.md),
  [testing/accessibility/release](docs/swiftui-recreation/09-testing-accessibility-performance-and-release.md),
  [legacy overview](docs/swiftui-recreation/README.md).
- [Global Maki spec integration adoption](.maki/SPEC.md), ID `antimatter-spec-tooling`.

Legacy docs need not acquire graph metadata to remain authoritative. Graph tools
index Markdown with `id` and `type`; Markdown links above are human/file-tool
navigation, not graph ID edges. New owning specs require unique `id`, `type` and
`title`; use `parent`, `depends-on`, `references` or `implements` for ID links.
Do not copy all legacy prose into new specs or add task-spec scaffolding.

## Rust source specifications

Source-adjacent implementation contracts are indexed for navigation:

- [Rune application/session runtime](crates/antimatter-app/SPEC.md), ID `antimatter-rust-runtime`.
- [Mattermost conversation/account services](crates/antimatter-services/SPEC.md), ID
  `antimatter-rust-services`.
- [Antimatter theme tokens](crates/antimatter-theme/SPEC.md), ID `antimatter-theme`.

These refine the existing approved boundary; the linked architecture/data and
API/auth documents retain shared ownership. They do not supersede legacy product
contracts or mirror issue status. Update applicable owners and source specs together
when implementation changes documented intent.

## Approved service design

The user approved issue #3's revised design on 2026-11-10. Its authoritative
contracts live in the owning architecture/data and API/WebSocket/auth documents
linked above, in their sections titled `Approved Rust replacement contract`.
They require a complete Rust rewrite with Tokio/reqwest/tokio-tungstenite
services, Rust-authored native bindings only for OS integration, validated
server-plus-user identity, isolated versioned state, and opt-in copy-only
saved-sign-in import. Their named legacy implementation prescriptions are
superseded; unchanged product/security contracts remain authoritative.

## Approved workspace foundation

The user approved the first issue #4 slice on 2026-11-10: same-revision
`rune-kit` controls and sidebar/resize mechanics, Antimatter semantic tokens
and compact message-ledger presentation of the existing single conversation.
The translated workspace/component implementation contract lives in documents
02, 06 and 07 linked above and the source-adjacent Rune runtime specification.
Existing session, persistence and delivery safety remain unchanged. This is not
approval to replace independent singleton Settings with an in-window page or
to claim tabs, incremental history, rich-action or native/live parity. The user
approved a second #4 slice on 2026-11-10: server-backed unread/mention counts and
best-effort channel-viewed marking for the existing single conversation, specified
in `crates/antimatter-app/SPEC.md` (Unread and viewed state). Per-pane/tab unread remains later work.

## Approved bootstrap and verification gates

The approved minimal application is a standalone edition-2024 Rust package
`antimatter`, porting Rune `examples/hello` at revision
`257f5599c8e499bb7dfd7ee03f57a9932724244a`, with a pinned git dependency and
lockfile. Cargo is the primary application development entry. The window title
is `Antimatter`; retain the hello label, `on` scene, accessible `Lights` switch,
stable `switch`/`knob` keys and spring interaction test. This bootstrap implements
no Mattermost services and changes no Swift/Xcode/product CI files. Existing
Swift files remain reference material, not a parallel product. The approved #3
secure-input verification additionally permits an `auth-proof` scene with only
synthetic PAT/password values; it exercises Rune secure edits without accessing
credentials, persistence or network services. Native execution now defaults to the service-backed conversation entry with
explicit opt-in Remember and explicit saved-account connection described in
document 04; headless default and the explicit `hello` scene
retain the bootstrap. The `conversation-proof` scene renders only synthetic data
and starts no services. Real-account mode rejects headless exports, and all native
sessions reject tracing; no credentials/account storage are accessed headlessly.

Bootstrap acceptance requires `cargo check --locked`/`cargo test --locked`, the hello interaction
assertion, accessible keyed-control tree assertions before/after deterministic
scripted input, and rendering **and visually inspecting** both default/toggled
PNGs. The reproducible headless self-check writes only synthetic artifacts into
ignored `build/rune-headless/`; its tree/state and PNG dimension assertions are
not a substitute for visual inspection or native accessibility checks.
Upstream command pattern:

`cargo run -- --script <events.json> --at 1 --tree <tree.json> --snap <image.png>`

Synthetic event: `{"events":[{"t":0.1,"type":"tap","key":"switch"}]}`.
Confirm repeatable offline execution and the Rust/macOS build floor before
claiming bootstrap readiness. Pin the upstream Rust toolchain, 1.99.1.
The macOS 14+ target in the legacy overview's Purpose/Approved decisions remains
product intent, not a validated Rust/Rune runtime minimum. Headless execution on
a newer macOS does not validate that floor; native hardware checks remain required.
Headless success proves only bootstrap interactions, not Mattermost parity.
Keychain/SAML, notifications, IME/accessibility, singleton settings/multiwindow,
real-server auth/reconnect and signed/notarized release need native/live checks.
Never put credentials or user data into logs, trees, screenshots or fixtures.
Specify account/server identity and non-destructive legacy-data migration before
writes; do not delete user state or uncommitted source changes.

## Execution references (not a status ledger)

GitHub alone owns tasks, dependencies, progress and blockers:

- `ericschmar/antimatter#1`: minimal read-only spec integration (this change).
- `ericschmar/antimatter#2`: Rune bootstrap and headless proof.
- `ericschmar/antimatter#3`: authentication/services/persistence.
- `ericschmar/antimatter#4`: workspace and native macOS behavior.
- `ericschmar/antimatter#5`: Cargo workflows and release/parity verification.

Do not mirror mutable issue statuses or checklists here. Commit progress only
with explicit user authorization; pushing requires separate authorization.
Preserve `Sources/AntimatterApp/RichMessageContent.swift` local edits.
