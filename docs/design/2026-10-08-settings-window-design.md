# Native singleton Settings window — implementation plan

## Scope

- Replace the workspace-owned Settings sheet with one native macOS Settings window that may remain open beside the workspace.
- Open or activate that same window from the account menu and `Command-,`.
- Retain the current Settings pages, `@AppStorage` preferences, account-management callbacks, and accessibility labels.
- Let macOS provide the title bar, red close control, `Command-W`, window activation, and saved frame/position.

Out of scope:

- No AppKit `NSWindowController`, custom window registry, manual close lifecycle, or custom frame persistence.
- No redesign of Settings content or account/session semantics.
- No change to the workspace or direct-message window styles.

## Ordered implementation

1. Add a private `SettingsWindowHost` beside `AntimatterApp` in `Sources/AntimatterApp/AntimatterApp.swift`.
   - Give it the active `MattermostSession`, saved sessions, and the existing `selectSession`, `addAccount`, and `disconnect` callbacks.
   - Create and own `@StateObject private var navigation: NavigationViewModel`, initialized with that session.
   - Render `SettingsView` using `navigation.channels`; call `await navigation.load()` from the host while the Settings window is alive.
   - Key the host/content by `session.serverURL`. A server switch must replace the host and its navigation/API client rather than preserve state for the prior server.

2. Add a `WindowGroup("Settings", id: "settings")` scene to `AntimatterApp.body` in `Sources/AntimatterApp/AntimatterApp.swift`.
   - Read the global `authentication` state in that scene, not workspace-local state.
   - When `authentication.connectedSession` exists, render the keyed `SettingsWindowHost` and inject the same app-wide environment objects needed by `SettingsView` (`accentColorSettings` and `userColorSettings`).
   - When there is no connected session during add-account or logout, render an inert signed-out/unavailable root. It must not retain or display the previous server's account or channel data.
   - Use the ordinary native title-bar window style for this scene, set the current `780 x 540` default size, and do not set a fixed frame. Keep the stable scene ID so SwiftUI/macOS restores and reactivates the one window.

3. Convert Settings opening to the scene route in `Sources/AntimatterApp/WorkspaceCommands.swift`.
   - Keep `@Environment(\.openWindow)`.
   - Remove `WorkspaceSettingsActionKey`, `FocusedValues.workspaceSettingsAction`, and `@FocusedValue(\.workspaceSettingsAction)`.
   - Have the existing `Settings…` command invoke `openWindow(id: "settings")` directly. The item remains available outside a focused workspace and repeated invocations activate the singleton scene.

4. Remove sheet presentation state and wiring from `Sources/AntimatterApp/WorkspaceShell.swift`.
   - Add/retain `@Environment(\.openWindow)` at this boundary and pass `openWindow(id: "settings")` as the existing account-menu `onOpenSettings` action.
   - Remove `isSettingsPresented`, the focused-scene settings action, and the `.sheet(isPresented:)` block with its `SettingsView` construction.
   - Keep the unrelated command-palette, focus, account-menu, navigation, and realtime state unchanged.

5. Make `SettingsView` window-neutral in `Sources/AntimatterApp/SettingsView.swift`.
   - Remove its `close` stored callback and initializer parameter.
   - Remove the `.toolbar` cancellation-action custom x button and its close accessibility/help strings.
   - Retain the navigation split view, `navigationTitle("Settings")`, current `780 x 540` content sizing/default scene size, persisted preference keys, session/account callbacks, and existing Settings accessibility labels.
   - Keep `AccountSettingsViewModel` tied to the `SettingsView` instance. Because the enclosing host is keyed by `serverURL`, account profile/notification work is recreated for every server change; do not introduce a global account-settings model.

## State and lifecycle

- `AuthenticationViewModel` remains the sole owner of active/saved session state.
- `WorkspaceShell` no longer owns any Settings visibility state or Settings data flow.
- `SettingsWindowHost` owns only its Settings-window-local, session-bound navigation state; it loads channel data only while the window exists.
- `SettingsView` continues to own its `AccountSettingsViewModel`; host replacement on `serverURL` change prevents stale profile/notification writes.
- Closing through the red traffic-light control or `Command-W` destroys the host; opening again creates it and loads channels/account preferences anew.
- A Settings window can keep the app alive after the last workspace window closes because `AppDelegate.applicationShouldTerminateAfterLastWindowClosed` returns `true`; this is normal native window behavior and requires no special close handling.

## Validation

1. Run `swift build` and `swift test` after implementation. Existing Swift 6 warnings in unrelated files are not regressions unless this change adds new diagnostics.
2. Add focused `NativeTests/AntimatterAppTests` coverage only for extracted, non-UI routing helpers if implementation needs one; do not add brittle tests that attempt to instantiate or assert SwiftUI `WindowGroup` activation.
   - Verify the Settings route is the stable `"settings"` scene ID and both command/account-menu callbacks request it.
   - Verify changing the active server rebuilds Settings-owned session-bound state rather than reusing the old server URL.
3. Manually test on macOS:
   - account-menu Settings and `Command-,` open Settings;
   - repeating either action while open brings the same window forward, with no duplicate;
   - standard close control and `Command-W` close it; reopening restores the macOS-managed frame;
   - Settings remains usable beside the workspace;
   - switch accounts while Settings is open and confirm Profile, notification preferences, and channel notification rows belong to the new server;
   - add-account/logout while Settings is open shows no old account data;
   - VoiceOver identifies the native window/title/close control, Settings sidebar sections, and each channel-notification control distinctly.

## Migration/removal checklist

- Delete the sheet-only Boolean, focused settings action key/extension, `.sheet` modifier, `SettingsView.close`, and custom x toolbar item.
- Do not carry forward sheet-specific dismissal behavior, custom frame restoration, a window registry, or `NSWindowController` code.
- Preserve the `"settings"` scene ID as the singleton/activation and restoration identity.

## Risks and decisions

- The signed-out Settings root is intentionally inert rather than closing the Settings window. This preserves one reusable native window and avoids leaking old-server content.
- Confirm manually that `openWindow(id: "settings")` reactivates an already-open `WindowGroup` on the supported macOS version. Escalate to an AppKit controller only if that platform behavior fails; do not add it preemptively.
- `SettingsWindowHost` needs access to the current session at app-scene scope because `NavigationViewModel` cannot safely be captured from `WorkspaceShell`.
