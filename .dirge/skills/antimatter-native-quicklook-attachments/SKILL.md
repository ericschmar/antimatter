---
name: antimatter-native-quicklook-attachments
description: Add native macOS Quick Look previews for Mattermost attachments in the SwiftUI timeline.
---

# Native attachment Quick Look

- Mattermost attachment downloads arrive as `Data` through `MattermostTimelineLoader.loadFileData(fileID:)` and are held by `TimelineViewModel.fileData`.
- Load all post attachments, not only images, before enabling previews. Preserve the original filename extension when materializing temporary files so Quick Look recognizes the type.
- On macOS, SwiftUI's `quickLookPreview` modifier is unavailable. Use the public `QuickLookUI` framework's `QLPreviewPanel` with a persistent `QLPreviewPanelDataSource` instead.
- Under Swift 6, import the legacy Objective-C Quick Look API with `@preconcurrency import QuickLookUI`; make UI entry points `@MainActor`, and use `@unchecked Sendable` for the persistent data-source object to satisfy imported protocol isolation.
- Keep cached attachment files under `FileManager.default.temporaryDirectory` and write each as `<file-id>-<original-filename>` before passing the file URL to the panel.

## Verification

```sh
xcodebuild -project Antimatter.xcodeproj -scheme Antimatter -configuration Debug -sdk macosx build CODE_SIGNING_ALLOWED=NO
```
