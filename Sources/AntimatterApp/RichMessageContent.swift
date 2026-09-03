import AntimatterFoundation
import AppKit
import MarkdownUI
@preconcurrency import QuickLookUI
import SwiftUI

struct RichMessageContent: View {
    let post: MattermostPost
    let fontSize: Double
    let currentUsername: String?
    let fileData: [String: Data]

    private var containsHighlightableMention: Bool {
        MattermostMentionMatcher.containsHighlightableMention(
            in: post.message,
            username: currentUsername
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Markdown(post.message)
                .markdownTheme(
                    .gitHub
                        .text { FontSize(fontSize) }
                        .codeBlock { configuration in
                            ChatCodeBlock(configuration: configuration)
                        }
                )
                .tint(WorkspaceTheme.accent)
                .foregroundStyle(WorkspaceTheme.primaryText)
                .textSelection(.enabled)
                .id(fontSize)

            if let previewURL {
                ChatLinkPreview(url: previewURL)
            }

            if !imageFiles.isEmpty {
                ChatImageAttachment(files: imageFiles, data: fileData)
            }

            if !nonImageFiles.isEmpty {
                ForEach(nonImageFiles) { file in
                    FileAttachmentRow(file: file, data: fileData[file.id])
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

    private var previewURL: URL? {
        post.message
            .split(whereSeparator: \.isWhitespace)
            .compactMap { URL(string: String($0).trimmingCharacters(in: .punctuationCharacters)) }
            .first { $0.scheme == "https" || $0.scheme == "http" }
    }

    private var imageFiles: [MattermostFile] {
        post.files.filter { $0.mimeType.hasPrefix("image/") }
    }

    private var nonImageFiles: [MattermostFile] {
        post.files.filter { !$0.mimeType.hasPrefix("image/") }
    }
}

private struct ChatCodeBlock: View {
    let configuration: CodeBlockConfiguration
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(configuration.content, forType: .string)
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: "doc.on.doc")
                        .font(.system(size: 11, weight: .medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .accessibilityLabel("Copy \(language) code")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(WorkspaceTheme.primaryText.opacity(0.05))

            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .markdownTextStyle {
                        FontFamilyVariant(.monospaced)
                        FontSize(.em(0.85))
                    }
                    .padding(14)
            }
        }
        .frame(maxWidth: 420, alignment: .leading)
        .background(
            WorkspaceTheme.raisedSurface,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(WorkspaceTheme.divider, lineWidth: 1)
        }
        .markdownMargin(top: 0, bottom: 16)
    }

    private var language: String {
        guard let language = configuration.language, !language.isEmpty else {
            return "code"
        }
        return language
    }
}

private struct ChatLinkPreview: View {
    let url: URL

    var body: some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                Image(systemName: "link")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.accent)
                    .frame(width: 42, height: 42)
                    .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(url.host ?? url.absoluteString)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(2)
                    Text(url.absoluteString)
                        .font(.system(size: 11))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: 360, alignment: .leading)
            .background(WorkspaceTheme.raisedSurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct ChatImageAttachment: View {
    let files: [MattermostFile]
    let data: [String: Data]

    var body: some View {
        Group {
            if let first = files.first, let data = data[first.id], let image = NSImage(data: data) {
                Button {
                    openQuickLookPreview(for: first, data: data)
                } label: {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: 300, maxHeight: 260)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(alignment: .bottomTrailing) {
                            if files.count > 1 {
                                Label("\(files.count) images", systemImage: "chevron.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(.black.opacity(0.5), in: Capsule())
                                    .padding(12)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Preview image \(first.name)")
            } else {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 300, height: 120)
                    .background(WorkspaceTheme.raisedSurface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
    }
}

private struct FileAttachmentRow: View {
    let file: MattermostFile
    let data: Data?

    var body: some View {
        Button {
            if let data {
                openQuickLookPreview(for: file, data: data)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "doc.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(WorkspaceTheme.attention)
                    .frame(width: 44, height: 44)
                    .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 1) {
                    Text(file.name)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(WorkspaceTheme.primaryText)
                    Text(detail)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                }
                Spacer(minLength: 0)
                Image(systemName: data == nil ? "arrow.down.circle" : "eye")
                    .font(.system(size: 20))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
            .padding(12)
            .frame(maxWidth: 360, alignment: .leading)
            .background(WorkspaceTheme.raisedSurface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(data == nil)
        .accessibilityLabel("Preview attached file \(file.name), \(detail)")
    }

    private var detail: String {
        "\(file.mimeType) · \(ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))"
    }
}

private final class AttachmentQuickLookPreview: NSObject, QLPreviewPanelDataSource, @unchecked Sendable {
    static let shared = AttachmentQuickLookPreview()
    private var url: URL?

    @MainActor
    func show(url: URL) {
        self.url = url
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.dataSource = self
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
    }

    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        url == nil ? 0 : 1
    }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        url as NSURL?
    }
}

@MainActor
private func openQuickLookPreview(for file: MattermostFile, data: Data) {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("AntimatterAttachments", isDirectory: true)
    let filename = "\(file.id)-\(URL(fileURLWithPath: file.name).lastPathComponent)"
    let url = directory.appendingPathComponent(filename)
    do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        AttachmentQuickLookPreview.shared.show(url: url)
    } catch {
        return
    }
}
