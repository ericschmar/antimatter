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
            appendAttachmentReferences(urls)
        }
        .onChange(of: channelID) { _, channelID in
            composer.select(channelID: channelID)
        }
        .onChange(of: composer.height) { _, _ in composer.persistHeight() }
    }

    private func appendAttachmentReferences(_ urls: [URL]) {
        let references = urls.map { "[\($0.lastPathComponent)](\($0.absoluteString))" }.joined(separator: "\n")
        composer.message += composer.message.isEmpty ? references : "\n\(references)"
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
