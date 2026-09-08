---
name: antimatter-native-account-settings
description: Add native Mattermost account switching, profile editing, and server-synced notification preferences.
---

# Native Mattermost account settings

- Persist multiple sessions in `MattermostSessionStore` by keeping an ordered UserDefaults server URL index while tokens stay per-server in Keychain. Keep `lastMattermostServerURL` for active-session compatibility.
- Make account switching replace the workspace root with `.id(activeSession.serverURL)` so its `@StateObject` network/view-model graph is recreated for the selected server.
- SwiftPM automatically includes files under target directories, but every new source must be manually registered in `Antimatter.xcodeproj/project.pbxproj` for Xcode: add a PBXFileReference, a PBXBuildFile, group membership, and the correct app/Foundation source build phase. PBXFileReference and PBXBuildFile object IDs must be distinct; reusing an ID damages the project (`PBXFileReference buildPhase` selector error).
- Verify the Xcode project immediately after editing it with `xcodebuild -project Antimatter.xcodeproj -scheme Antimatter -configuration Debug build CODE_SIGNING_ALLOWED=NO`.
- If SwiftUI reports that a large expression cannot be type-checked in reasonable time, split chained `guard let` bindings or pass an explicitly typed closure rather than restructuring unrelated UI.
- Model profile and preference endpoints in `MattermostAccountSettings` over `MattermostAPIClient`: `/users/me`, `/users/{id}/patch`, `/users/{id}/image`, `/users/{id}/status`, `/users/{id}/status/custom`, `/users/{id}/password`, and `/users/{id}/preferences`.
- Use `POST /users/{id}/image` as `multipart/form-data` with an `image` part. `MattermostAPIClient.postMultipart` decodes a JSON response.
- Profile UI should use the Nibware `avatar-edit` pattern: circular 72pt avatar with trailing camera badge, adapted to `WorkspaceTheme`.
- Test session persistence in `AppConfigurationTests` using `InMemorySecureValueStore`; test endpoint paths/methods with the existing `URLProtocolStub`. The stub does not retain `httpBody`, so assert method, path, headers, and response decoding rather than request JSON body.

## Verification

```bash
xcodebuild -project Antimatter.xcodeproj -scheme Antimatter -configuration Debug build CODE_SIGNING_ALLOWED=NO && swift test
```
