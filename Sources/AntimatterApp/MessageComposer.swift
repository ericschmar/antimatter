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

    private var composerDisabled: Bool {
        channelID == nil || composer.isSending
    }

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
                    ComposerFormattingToolbar(
                        insert: insertFormatting,
                        attachFiles: { isImportingFiles = true },
                        createPoll: { isCreatingPoll = true }
                    )
                    .disabled(composerDisabled)

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

    private func insertFormatting(_ format: ComposerFormat) {
        composer.message = format.apply(to: composer.message)
        composer.persistDraft()
        onTyping()
    }
}

private enum ComposerFormat {
    case bold
    case italic
    case underline
    case bulletedList
    case numberedList
    case quote
    case link

    func apply(to message: String) -> String {
        switch self {
        case .bold:
            wrapped(message, prefix: "**", suffix: "**", placeholder: "bold text")
        case .italic:
            wrapped(message, prefix: "*", suffix: "*", placeholder: "italic text")
        case .underline:
            wrapped(message, prefix: "<u>", suffix: "</u>", placeholder: "underlined text")
        case .bulletedList:
            appended(to: message, text: "- ")
        case .numberedList:
            appended(to: message, text: "1. ")
        case .quote:
            appended(to: message, text: "> ")
        case .link:
            appended(to: message, text: "[link text](https://)")
        }
    }

    private func wrapped(_ message: String, prefix: String, suffix: String, placeholder: String) -> String {
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedMessage.isEmpty else { return prefix + placeholder + suffix }
        return prefix + message + suffix
    }

    private func appended(to message: String, text: String) -> String {
        message.isEmpty || message.hasSuffix("\n") ? message + text : message + "\n" + text
    }
}

private struct ComposerFormattingToolbar: View {
    let insert: (ComposerFormat) -> Void
    let attachFiles: () -> Void
    let createPoll: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            formatButton("bold", label: "Bold", format: .bold)
            formatButton("italic", label: "Italic", format: .italic)
            formatButton("underline", label: "Underline", format: .underline)
            toolbarDivider
            formatButton("list.bullet", label: "Bulleted list", format: .bulletedList)
            formatButton("list.number", label: "Numbered list", format: .numberedList)
            toolbarDivider
            formatButton("text.quote", label: "Quote", format: .quote)
            formatButton("link", label: "Insert link", format: .link)
            toolbarDivider
            actionButton("paperclip", label: "Attach files", action: attachFiles)
            actionButton("chart.bar", label: "Create poll", action: createPoll)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 3)
        .background(WorkspaceTheme.canvas.opacity(0.55), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }

    private var toolbarDivider: some View {
        Divider()
            .frame(height: 18)
            .padding(.horizontal, 4)
            .overlay(WorkspaceTheme.divider)
    }

    private func formatButton(_ icon: String, label: String, format: ComposerFormat) -> some View {
        actionButton(icon, label: label) {
            insert(format)
        }
    }

    private func actionButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .frame(width: 28, height: 26)
                .contentShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(WorkspaceTheme.secondaryText)
        .help(label)
        .accessibilityLabel(label)
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
            VStack(spacing: 0) {
                formRow("Question", placeholder: "What would you like to ask?", text: $question)
                Divider().padding(.leading, 16)
                ForEach(options.indices, id: \.self) { index in
                    formRow(
                        "Option \(index + 1)",
                        placeholder: "Answer \(index + 1)",
                        text: $options[index],
                        remove: options.count > 2 ? { options.remove(at: index) } : nil
                    )
                    if index < options.indices.last! {
                        Divider().padding(.leading, 16)
                    }
                }
            }
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .formaCard(0)
            if options.count < 10 {
                Button("Add option", systemImage: "plus") {
                    options.append("")
                }
                .buttonStyle(.plain)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(WorkspaceTheme.navigationAccent)
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

    @ViewBuilder
    private func formRow(
        _ label: String,
        placeholder: String,
        text: Binding<String>,
        remove: (() -> Void)? = nil
    ) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 92, alignment: .leading)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .foregroundStyle(WorkspaceTheme.primaryText)
            if let remove {
                Button(action: remove) {
                    Image(systemName: "minus.circle")
                }
                .buttonStyle(.plain)
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .accessibilityLabel("Remove \(label.lowercased())")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 15)
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
