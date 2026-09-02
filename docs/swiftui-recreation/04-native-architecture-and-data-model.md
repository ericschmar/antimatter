# Native Architecture and Data Model

## Modules

- `AntimatterMacApp`: app lifecycle, scenes, commands, deep links, settings scene.
- `Features/Auth`, `Features/Sidebar`, `Features/Workspace`, `Features/Timeline`, `Features/Composer`, `Features/Search`, `Features/Attachments`, `Features/Settings`.
- `Core/Mattermost`: REST client, websocket actor, Codable wire models, error mapping.
- `Core/Persistence`: Keychain credentials, SwiftData/UserDefaults local state, workspace codec.
- `UI`: theme, primitives, AppKit representables, Nibware-adapted source.

## State ownership

Use Swift Observation. `@MainActor @Observable final class AppStore` owns account/session selection, loaded data, presentation routes, and feature stores. Network services are actors. Views emit intent methods to stores; they do not construct API requests.

Maintain normalized dictionaries keyed by server ID for users, teams, channels, posts, members, status, and reactions. `TimelineStore` holds per-channel ordered IDs, cursors, loading state, scroll anchor, and optimistic mutations. `WorkspaceStore` owns pane/tree state. Keep pane state separate from channel server data.

## Codable models

Mirror Mattermost v4 JSON with Swift `CodingKeys` for snake case. Essential fields are listed in `appendix/parity-matrix.md`: users, teams, channels (`O/P/D/G`), members, posts, files, reactions, poll props, and status.

Use local models for:

- `AppPreferences`: theme, font, profile picture visibility, own-post marker, notification settings, composer selection.
- `LocalNavigationState`: favorites, archives, channel emoji map, channel order, collapsed sections.
- `WorkspaceSnapshot(version: 1)`: durable panes, active pane, split tree ratios, selected tab per group.
- `PaneState`: draft, reply/edit target, scroll anchor, composer height.

## Persistence

- Keychain: bearer token and any SSO/session secret, keyed by normalized server URL plus account ID.
- `UserDefaults` or SwiftData: non-secret preferences, local navigation state, workspace snapshot, last team/channel.
- Application Support cache: images/attachment thumbnails only when cache policy is defined; never serialize authorization headers or tokens.
- Version every persisted record and migrate explicitly. If a workspace snapshot references unknown channels or has invalid tree ratios/leaves, reset to a safe single/empty workspace.

## Concurrency and lifecycle

- All REST/websocket decoding occurs outside `MainActor`.
- Apply store mutations on `MainActor` in small batches.
- Cancel history/search/image work when the owning pane closes or query changes.
- On sign-out: close websocket, cancel tasks, remove Keychain secret, clear account-specific cache/state, and reset UI.
