---
name: antimatter-native-settings-shell
description: Build Antimatter's native SwiftUI macOS-style settings sheet with a sidebar and dense preference groups.
---

# Native Settings Shell

## Approach

1. Keep existing `@AppStorage` keys exactly intact; the settings UI is presentation-only around persisted preferences.
2. Use `NavigationSplitView` with a `.sidebar` `List` for preference categories and a scrollable detail pane.
3. Use compact settings rows inside one `VStack` surface with 8 pt radius and `WorkspaceTheme` tokens; avoid card shadows, gradients, or mobile-like layouts.
4. Place controls in the trailing edge and preserve descriptive labels and accessibility labels supplied by standard SwiftUI controls.
5. Size the sheet explicitly around `780 x 540` so the sidebar and control groups have desktop density.

## Existing sections

- General: message font size and grouping interval.
- Appearance: system appearance, compact timeline, avatars.
- Notifications: notifications enablement.
- Workspace: channel preview preference.
- Account: destructive disconnect action.

## Verification

Run:

```sh
swift build
swift test
git diff --check
```

The package test target currently covers foundation code, so UI compilation is the direct automated check for `SettingsView`.