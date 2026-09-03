import AntimatterFoundation
import AppKit
import MarkdownUI
import SwiftUI

struct RichMessageContent: View {
    let post: MattermostPost
    let fontSize: Double
    let currentUsername: String?

    private var containsHighlightableMention: Bool {
        MattermostMentionMatcher.containsHighlightableMention(
            in: post.message,
            username: currentUsername
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Markdown(post.message)
                .markdownTheme(.gitHub.text { FontSize(fontSize) })
                .tint(WorkspaceTheme.accent)
                .foregroundStyle(WorkspaceTheme.primaryText)
                .textSelection(.enabled)
                .id(fontSize)

            if !post.files.isEmpty {
                ForEach(post.files) { file in
                    FileAttachmentRow(file: file)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(containsHighlightableMention ? 5 : 0)
        .background {
            if containsHighlightableMention {
                RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius)
                    .fill(WorkspaceTheme.attention.opacity(0.18))
            }
        }
        .accessibilityHint(containsHighlightableMention ? "Contains a channel or personal mention." : "")
    }
}

private struct FileAttachmentRow: View {
    let file: MattermostFile

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(WorkspaceTheme.secondaryText)
            VStack(alignment: .leading, spacing: 1) {
                Text(file.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                Text(detail)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
            Spacer(minLength: 0)
            Button("Copy name", action: copyName)
                .buttonStyle(.borderless)
                .font(.system(size: 11))
                .foregroundStyle(WorkspaceTheme.accent)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(WorkspaceTheme.raisedSurface)
        .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Attached file \(file.name), \(detail)")
    }

    private var detail: String {
        "\(file.mimeType) · \(ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))"
    }

    private func copyName() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(file.name, forType: .string)
    }
}
