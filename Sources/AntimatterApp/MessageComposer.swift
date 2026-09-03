import AntimatterFoundation
import SwiftUI
import UniformTypeIdentifiers

struct MessageComposer: View {
    @ObservedObject var composer: ComposerViewModel
    let channelID: String?
    let onSent: (MattermostPost) -> Void
    let onTyping: () -> Void
    @State private var isImportingFiles = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if composer.replyRootID != nil {
                HStack {
                    Text("Replying in thread")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                    Spacer()
                    Button("Cancel", action: composer.cancelReply)
                        .buttonStyle(.borderless)
                }
            }
            if !composer.attachmentURLs.isEmpty {
                ComposerAttachmentChips(urls: composer.attachmentURLs, remove: composer.removeAttachment)
            }
            TextEditor(text: $composer.message)
                .font(.system(size: 13))
                .scrollContentBackground(.hidden)
                .padding(7)
                .background(WorkspaceTheme.raisedSurface)
                .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))
                .frame(height: composer.height)
                .disabled(channelID == nil || composer.isSending)
                .onChange(of: composer.message) { _, _ in
                    composer.persistDraft()
                    onTyping()
                }
                .onDrop(of: [.fileURL, .plainText], isTargeted: nil) { providers in
                    loadDroppedText(from: providers)
                }

            HStack(spacing: 10) {
                Button {
                    isImportingFiles = true
                } label: {
                    Label("Attach", systemImage: "paperclip")
                }
                .buttonStyle(.borderless)
                .disabled(channelID == nil || composer.isSending)

                Text("Markdown supported")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                Spacer()
                if let error = composer.sendError {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundStyle(WorkspaceTheme.attention)
                        .lineLimit(1)
                }
                Button(composer.isSending ? "Sending…" : "Send") {
                    composer.send(onSent: onSent)
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .disabled(channelID == nil || composer.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || composer.isSending)
            }
            .font(.system(size: 12, weight: .medium))
        }
        .padding(12)
        .background(WorkspaceTheme.surface)
        .fileImporter(isPresented: $isImportingFiles, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
            guard case let .success(urls) = result else { return }
            composer.addAttachments(urls)
        }
        .onChange(of: channelID) { _, channelID in
            composer.select(channelID: channelID)
        }
        .onChange(of: composer.height) { _, _ in composer.persistHeight() }
    }

    private func loadDroppedText(from providers: [NSItemProvider]) -> Bool {
        guard let provider = providers.first else { return false }
        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
            let text = item as? String ?? (item as? Data).flatMap { String(data: $0, encoding: .utf8) }
            guard let text else { return }
            Task { @MainActor in composer.message += text }
        }
        return true
    }
}

private struct ComposerAttachmentChips: View {
    let urls: [URL]
    let remove: (URL) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
            ForEach(urls, id: \.self) { url in
                HStack(spacing: 7) {
                    Circle().fill(color(for: url)).frame(width: 6, height: 6)
                    Text(url.lastPathComponent).lineLimit(1)
                    Button { remove(url) } label: {
                        Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .accessibilityLabel("Remove \(url.lastPathComponent)")
                }
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(WorkspaceTheme.raisedSurface, in: Capsule())
            }
            }
        }
    }

    private func color(for url: URL) -> Color {
        switch url.pathExtension.lowercased() {
        case "pdf": WorkspaceTheme.attention
        case "jpg", "jpeg", "png", "gif", "webp": .purple
        case "xls", "xlsx", "csv": WorkspaceTheme.accent
        default: WorkspaceTheme.secondaryText
        }
    }
}
