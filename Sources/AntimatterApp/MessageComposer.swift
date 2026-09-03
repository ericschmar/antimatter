import AntimatterFoundation
import SwiftUI
import UniformTypeIdentifiers

struct MessageComposer: View {
    @ObservedObject var composer: ComposerViewModel
    let channelID: String?
    let teamID: String?
    let onSent: (MattermostPost) -> Void
    let onTyping: () -> Void
    @State private var isImportingFiles = false
    @State private var isCreatingPoll = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let replyPost = composer.replyPost {
                HStack(spacing: 8) {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(WorkspaceTheme.navigationAccent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Replying in thread")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(WorkspaceTheme.primaryText)
                        Text(replyPost.message)
                            .font(.system(size: 11))
                            .foregroundStyle(WorkspaceTheme.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Button(action: composer.cancelReply) {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .accessibilityLabel("Cancel reply")
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(WorkspaceTheme.raisedSurface.opacity(0.7), in: RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous))
            }
            if !composer.attachmentURLs.isEmpty {
                ComposerAttachmentChips(urls: composer.attachmentURLs, remove: composer.removeAttachment)
            }
            VStack(spacing: 0) {
                TextEditor(text: $composer.message)
                    .font(.system(size: 13))
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(height: composer.height)
                    .disabled(channelID == nil || composer.isSending)
                    .onChange(of: composer.message) { _, _ in
                        composer.persistDraft()
                        onTyping()
                    }
                    .onDrop(of: [.fileURL, .plainText], isTargeted: nil) { providers in
                        loadDroppedText(from: providers)
                    }

                Divider().overlay(WorkspaceTheme.divider)

                HStack(spacing: 8) {
                    Button {
                        isImportingFiles = true
                    } label: {
                        Image(systemName: "paperclip")
                            .font(.system(size: 13, weight: .medium))
                            .frame(width: 28, height: 26)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .help("Attach files")
                    .disabled(channelID == nil || composer.isSending)

                    Button {
                        isCreatingPoll = true
                    } label: {
                        Image(systemName: "chart.bar")
                            .font(.system(size: 13, weight: .medium))
                            .frame(width: 28, height: 26)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .help("Create poll")
                    .accessibilityLabel("Create poll")
                    .disabled(channelID == nil || composer.isSending)

                    Text("⌘ ↩ Send")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                    Spacer()
                    if let error = composer.sendError {
                        Text(error)
                            .font(.system(size: 11))
                            .foregroundStyle(WorkspaceTheme.attention)
                            .lineLimit(1)
                    }
                    Button {
                        composer.send(onSent: onSent)
                    } label: {
                        Image(systemName: composer.isSending ? "ellipsis" : "arrow.up")
                            .font(.system(size: 12, weight: .bold))
                            .frame(width: 28, height: 28)
                            .foregroundStyle(WorkspaceTheme.canvas)
                            .background(WorkspaceTheme.accent, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.return, modifiers: [.command])
                    .help(composer.isSending ? "Sending" : "Send message")
                    .disabled(channelID == nil || composer.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || composer.isSending)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 5)
            }
            .background(WorkspaceTheme.raisedSurface, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(WorkspaceTheme.divider, lineWidth: 1)
            }
        }
        .padding(12)
        .background(WorkspaceTheme.surface)
        .fileImporter(isPresented: $isImportingFiles, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
            guard case let .success(urls) = result else { return }
            composer.addAttachments(urls)
        }
        .sheet(isPresented: $isCreatingPoll) {
            PollComposer { question, options in
                composer.createPoll(question: question, options: options)
                isCreatingPoll = false
            }
        }
        .onChange(of: channelID) { _, channelID in
            composer.select(channelID: channelID, teamID: teamID)
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

private struct PollComposer: View {
    let create: (String, [String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var question = ""
    @State private var options = ["", ""]

    private var cleanedOptions: [String] {
        options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    private var canCreate: Bool {
        !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && cleanedOptions.count >= 2
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Create a poll")
                .font(.system(size: 20, weight: .semibold))
            TextField("Question", text: $question)
                .textFieldStyle(.roundedBorder)
            VStack(alignment: .leading, spacing: 8) {
                Text("Options")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                ForEach(options.indices, id: \.self) { index in
                    HStack {
                        TextField("Option \(index + 1)", text: $options[index])
                            .textFieldStyle(.roundedBorder)
                        if options.count > 2 {
                            Button {
                                options.remove(at: index)
                            } label: {
                                Image(systemName: "minus.circle")
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove option \(index + 1)")
                        }
                    }
                }
                if options.count < 10 {
                    Button("Add option", systemImage: "plus") {
                        options.append("")
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Create poll") {
                    create(question.trimmingCharacters(in: .whitespacesAndNewlines), cleanedOptions)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canCreate)
            }
        }
        .padding(24)
        .frame(width: 420)
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
                    Image(systemName: symbol(for: url))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(color(for: url))
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

    private func symbol(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "pdf": "doc.richtext"
        case "jpg", "jpeg", "png", "gif", "webp": "photo"
        case "xls", "xlsx", "csv": "tablecells"
        default: "doc"
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
