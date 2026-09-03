---
name: antimatter-native-attachment-preview
description: Recommend or implement native macOS attachment previews in Antimatter’s SwiftUI app.
---

# Native Attachment Preview

## Default choice

Use Apple’s `QuickLookUI` framework before considering a third-party dependency. Antimatter targets macOS 14, so SwiftUI’s `.quickLookPreview(_:)` is available without adding a package.

Quick Look handles macOS-previewable local files, including images, PDFs, audio/video, text, archives, iWork documents, and commonly Microsoft Office documents.

```swift
import QuickLookUI
import SwiftUI

struct AttachmentRow: View {
    let fileURL: URL
    @State private var previewURL: URL?

    var body: some View {
        Button(fileURL.lastPathComponent) {
            previewURL = fileURL
        }
        .quickLookPreview($previewURL)
    }
}
```

## Attachment availability

Quick Look requires a local file `URL`. Download or cache Mattermost attachments locally before assigning the URL to the preview binding.

## When not to use it

Use `PDFKit` only when the product needs a permanently embedded PDF reader or custom PDF-specific controls. For general attachment viewing, retain Quick Look because it has no dependency cost and follows native macOS file-preview behavior.

## Project orientation

Antimatter is a Swift 6 package targeting macOS 14. Native source is separated into `Sources/AntimatterApp` (SwiftUI application) and `Sources/AntimatterFoundation` (shared Mattermost/domain code); foundation tests reside in `NativeTests/AntimatterFoundationTests`. Existing SwiftPM dependencies include MarkdownUI, SwiftEmojiPicker, and EmojiKit.

## Verification

```sh
swift build
```
