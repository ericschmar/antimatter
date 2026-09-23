import AntimatterFoundation
import AppKit
import SwiftUI
import SwiftEmojiPicker
import UniformTypeIdentifiers

struct MessageComposer: View {
    @ObservedObject var composer: ComposerViewModel
    let channelID: String?
    let teamID: String?
    let onSent: (MattermostPost) -> Void
    let onTyping: () -> Void
    @State private var isImportingFiles = false
    @State private var isCreatingPoll = false
    @State private var isGiphyPickerPresented = false
    @State private var isMentionPickerPresented = false
    @State private var selectedMentionIndex = 0
    @State private var isEmojiPickerPresented = false
    @State private var selectedEmoji = ""
    @State private var composerWidth: CGFloat = 300
    private let mentionPickerHeight: CGFloat = 300

    private var composerDisabled: Bool {
        channelID == nil || composer.isSending
    }

    private var canSendMessage: Bool {
        !composerDisabled && composer.hasContent
    }

    private var mentionQuery: String? {
        let start = composer.message.lastIndex(where: \.isWhitespace)
            .map { composer.message.index(after: $0) } ?? composer.message.startIndex
        let token = composer.message[start...]
        guard token.hasPrefix("@") else { return nil }

        let query = String(token.dropFirst())
        guard query.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" || $0 == "." }) else {
            return nil
        }
        return query
    }

    private var mentionMatches: [MattermostUser] {
        guard let mentionQuery else { return [] }
        return composer.mentionableUsers.filter {
            mentionQuery.isEmpty
                || $0.username.localizedCaseInsensitiveContains(mentionQuery)
                || $0.displayName.localizedCaseInsensitiveContains(mentionQuery)
        }
    }

    private var mentionStart: String.Index? {
        let start = composer.message.lastIndex(where: \.isWhitespace)
            .map { composer.message.index(after: $0) } ?? composer.message.startIndex
        return composer.message[start...].hasPrefix("@") ? start : nil
    }

    private var mentionPickerX: CGFloat {
        guard let mentionStart else { return 0 }
        let textStorage = NSTextStorage(
            string: composer.message,
            attributes: [.font: NSFont.systemFont(ofSize: 13)]
        )
        let layoutManager = NSLayoutManager()
        let textContainer = NSTextContainer(
            size: NSSize(width: max(1, composerWidth - 16), height: .greatestFiniteMagnitude)
        )
        textContainer.lineFragmentPadding = 0
        layoutManager.addTextContainer(textContainer)
        textStorage.addLayoutManager(layoutManager)

        let characterIndex = composer.message.utf16.distance(
            from: composer.message.startIndex,
            to: mentionStart
        )
        let glyphIndex = layoutManager.glyphIndexForCharacter(at: characterIndex)
        let tokenX = layoutManager.location(forGlyphAt: glyphIndex).x + 8
        return min(max(0, tokenX), max(0, composerWidth - 300))
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
                    .background(TextEditorDropInterceptor())
                    .onChange(of: composer.message) { _, _ in
                        composer.persistDraft()
                        onTyping()
                        isMentionPickerPresented = mentionQuery != nil
                        selectedMentionIndex = 0
                    }
                    .onDrop(of: [.fileURL, .plainText], isTargeted: nil) { providers in
                        handleDrop(providers)
                    }
                    .onKeyPress(.return, phases: .down) { keyPress in
                        handleReturn(keyPress)
                    }
                    .onKeyPress(keys: [.upArrow, .downArrow], phases: .down) { keyPress in
                        handleArrow(keyPress)
                    }
                    .onKeyPress(.escape, phases: .down) { _ in
                        handleEscape()
                    }

                Divider().overlay(WorkspaceTheme.divider)

                HStack(spacing: 8) {
                    ComposerFormattingToolbar(
                        insert: insertFormatting,
                        chooseEmoji: showEmojiPicker,
                        attachFiles: { isImportingFiles = true },
                        createPoll: { isCreatingPoll = true },
                        openGiphy: { isGiphyPickerPresented = true },
                        giphyAvailable: composer.giphyClient != nil
                    )
                    .disabled(composerDisabled)

                    Spacer()
                    if let error = composer.sendError {
                        Text(error)
                            .font(.system(size: 11))
                            .foregroundStyle(WorkspaceTheme.attention)
                            .lineLimit(1)
                    }
                    Button(action: sendMessage) {
                        Image(systemName: composer.isSending ? "ellipsis" : "arrow.up")
                            .font(.system(size: 12, weight: .bold))
                            .frame(width: 28, height: 28)
                            .foregroundStyle(WorkspaceTheme.canvas)
                            .background(WorkspaceTheme.accent, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .help(composer.isSending ? "Sending" : "Send message")
                    .disabled(!canSendMessage)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 5)
            }
            .background(WorkspaceTheme.raisedSurface, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(WorkspaceTheme.divider, lineWidth: 1)
            }
            .overlay(alignment: .topLeading) {
                if isMentionPickerPresented {
                    MentionPicker(users: mentionMatches, selectedIndex: selectedMentionIndex) { user in
                        selectMention(user)
                    }
                    .frame(height: mentionPickerHeight, alignment: .top)
                    .alignmentGuide(.leading) { dimensions in
                        dimensions[.leading] - mentionPickerX
                    }
                    .offset(y: -(mentionPickerHeight + 8))
                }
            }
            .background {
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { composerWidth = proxy.size.width }
                        .onChange(of: proxy.size.width) { _, width in composerWidth = width }
                }
            }
        }
        .padding(12)
        .background(WorkspaceTheme.surface)
        .zIndex(isMentionPickerPresented ? 1 : 0)
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
        .sheet(isPresented: $isGiphyPickerPresented) {
            if let giphyClient = composer.giphyClient {
                GiphyPicker(client: giphyClient) { gif in
                    insertGIF(gif)
                    isGiphyPickerPresented = false
                }
            }
        }
        .onChange(of: channelID) { _, channelID in
            composer.select(channelID: channelID, teamID: teamID)
        }
        .onChange(of: composer.height) { _, _ in composer.persistHeight() }
        .emojiPicker(
            isPresented: $isEmojiPickerPresented,
            selectedEmoji: $selectedEmoji,
            selectedEmojiCategoryTintColor: WorkspaceTheme.accent
        )
        .onChange(of: selectedEmoji) { _, emoji in
            guard !emoji.isEmpty else { return }
            insertEmoji(emoji)
        }
    }

    private func handleReturn(_ keyPress: KeyPress) -> KeyPress.Result {
        guard !keyPress.modifiers.contains(.shift) else { return .ignored }
        if isMentionPickerPresented, !mentionMatches.isEmpty {
            let index = min(selectedMentionIndex, mentionMatches.count - 1)
            selectMention(mentionMatches[index])
        } else {
            sendMessage()
        }
        return .handled
    }

    private func handleArrow(_ keyPress: KeyPress) -> KeyPress.Result {
        guard isMentionPickerPresented, !mentionMatches.isEmpty else { return .ignored }
        if keyPress.key == .downArrow {
            selectedMentionIndex = min(selectedMentionIndex + 1, mentionMatches.count - 1)
        } else {
            selectedMentionIndex = max(selectedMentionIndex - 1, 0)
        }
        return .handled
    }

    private func handleEscape() -> KeyPress.Result {
        guard isMentionPickerPresented else { return .ignored }
        isMentionPickerPresented = false
        return .handled
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        var claimed = false
        for provider in providers {
            // File drags win over text so a dropped .txt attaches instead of
            // dumping its contents into the message.
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                claimed = true
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                    let url: URL?
                    if let loaded = item as? URL {
                        url = loaded
                    } else if let data = item as? Data {
                        url = URL(dataRepresentation: data, relativeTo: nil)
                    } else if let string = item as? String {
                        url = URL(string: string) ?? URL(fileURLWithPath: string)
                    } else {
                        url = nil
                    }
                    guard let url else { return }
                    Task { @MainActor in composer.addAttachments([url]) }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                claimed = true
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                    let text = item as? String ?? (item as? Data).flatMap { String(data: $0, encoding: .utf8) }
                    guard let text else { return }
                    Task { @MainActor in composer.message += text }
                }
            }
        }
        return claimed
    }

    private func insertFormatting(_ format: ComposerFormat) {
        composer.message = format.apply(to: composer.message)
        composer.persistDraft()
        onTyping()
    }

    private func insertEmoji(_ emoji: String) {
        composer.message += emoji
        composer.persistDraft()
        onTyping()
    }

    private func insertGIF(_ gif: GiphyGIF) {
        let markdown = "![\(gif.title.isEmpty ? "GIF" : gif.title)](\(gif.mediaURL.absoluteString))"
        composer.message += composer.message.isEmpty || composer.message.hasSuffix("\n")
            ? markdown
            : "\n\(markdown)"
        composer.persistDraft()
        onTyping()
    }

    private func showEmojiPicker() {
        selectedEmoji = ""
        isEmojiPickerPresented = true
    }

    private func selectMention(_ user: MattermostUser) {
        composer.insertMention(user.username)
        composer.persistDraft()
        onTyping()
        isMentionPickerPresented = false
    }

    private func sendMessage() {
        guard canSendMessage else { return }
        Task { @MainActor in
            await Task.yield()
            composer.send(onSent: onSent)
        }
    }
}

// TextEditor's underlying NSTextView natively accepts file drops by inserting
// the file path as text, which swallows drags before the composer's .onDrop
// handler runs. This probe strips the text view's drag registrations so file
// and text drags fall through to .onDrop. Re-runs from make and update because
// SwiftUI can recreate the underlying text view.
private struct TextEditorDropInterceptor: NSViewRepresentable {
    func makeNSView(context: Context) -> ProbeView {
        ProbeView()
    }

    func updateNSView(_ view: ProbeView, context: Context) {
        view.disableNativeDrops()
    }

    final class ProbeView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            disableNativeDrops()
        }

        func disableNativeDrops() {
            // The probe is a background of the TextEditor, so its superview
            // contains the editor's AppKit subtree and nothing else.
            guard let container = superview else { return }
            var queue: [NSView] = [container]
            while let view = queue.popLast() {
                if view is NSTextView {
                    view.unregisterDraggedTypes()
                }
                queue.append(contentsOf: view.subviews)
            }
        }
    }
}

private struct MentionPicker: View {
    let users: [MattermostUser]
    let selectedIndex: Int
    let select: (MattermostUser) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Mention someone")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.primaryText)
                .padding(12)
            Divider().overlay(WorkspaceTheme.divider)
            if users.isEmpty {
                Text("No matching channel members")
                    .font(.system(size: 12))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .padding(12)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(users.enumerated()), id: \.element.id) { index, user in
                                Button {
                                    select(user)
                                } label: {
                                    HStack(spacing: 9) {
                                        Text(initials(for: user.displayName))
                                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                                            .foregroundStyle(WorkspaceTheme.secondaryText)
                                            .frame(width: 24, height: 24)
                                            .background(WorkspaceTheme.raisedSurface, in: Circle())
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(user.displayName)
                                                .font(.system(size: 12, weight: .medium))
                                                .foregroundStyle(WorkspaceTheme.primaryText)
                                            Text("@\(user.username)")
                                                .font(.system(size: 11))
                                                .foregroundStyle(WorkspaceTheme.secondaryText)
                                        }
                                        Spacer()
                                    }
                                    .contentShape(Rectangle())
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(WorkspaceTheme.hoverSurface.opacity(index == selectedIndex ? 1 : 0))
                                }
                                .buttonStyle(.plain)
                                .id(index)
                            }
                        }
                    }
                    .onChange(of: selectedIndex) { _, index in
                        proxy.scrollTo(index)
                    }
                }
                .frame(maxHeight: 260)
            }
        }
        .frame(width: 300)
        .background(WorkspaceTheme.surface)
    }

    private func initials(for name: String) -> String {
        String(name.split(separator: " ").prefix(2).compactMap(\.first)).uppercased()
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
    let chooseEmoji: () -> Void
    let attachFiles: () -> Void
    let createPoll: () -> Void
    let openGiphy: () -> Void
    let giphyAvailable: Bool

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
            actionButton("face.smiling", label: "Add emoji", action: chooseEmoji)
            actionButton("paperclip", label: "Attach files", action: attachFiles)
            actionButton("chart.bar", label: "Create poll", action: createPoll)
            actionButton(
                "photo.on.rectangle.angled",
                label: giphyAvailable ? "Search Giphy" : "Giphy API key is not configured",
                action: openGiphy
            )
            .disabled(!giphyAvailable)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 3)
        .background(WorkspaceTheme.canvas.opacity(0.55), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }

    private var toolbarDivider: some View {
        Rectangle()
            .fill(WorkspaceTheme.divider)
            .frame(width: 1, height: 18)
            .padding(.horizontal, 4)
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
            VStack(alignment: .leading, spacing: 3) {
                Text("Create a poll")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                Text("Everyone in this chat can vote on the options you add.")
                    .font(.system(size: 11))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
            VStack(spacing: 0) {
                formRow("Question", placeholder: "What would you like to ask?", text: $question)
                Divider().overlay(WorkspaceTheme.divider).padding(.leading, 16)
                ForEach(options.indices, id: \.self) { index in
                    formRow(
                        "Option \(index + 1)",
                        placeholder: "Answer \(index + 1)",
                        text: $options[index],
                        remove: options.count > 2 ? { options.remove(at: index) } : nil
                    )
                    if index < options.indices.last! {
                        Divider().overlay(WorkspaceTheme.divider).padding(.leading, 16)
                    }
                }
            }
            .background(WorkspaceTheme.raisedSurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(WorkspaceTheme.divider, lineWidth: 1))
            if options.count < 10 {
                Button {
                    options.append("")
                } label: {
                    Label("Add option", systemImage: "plus")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(WorkspaceTheme.navigationAccent)
                }
                .buttonStyle(.plain)
                .help("Add another answer")
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create poll") {
                    create(question.trimmingCharacters(in: .whitespacesAndNewlines), cleanedOptions)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!canCreate)
            }
        }
        .padding(24)
        .frame(width: 420)
        .background(WorkspaceTheme.surface)
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
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .frame(width: 84, alignment: .leading)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(WorkspaceTheme.primaryText)
            if let remove {
                Button(action: remove) {
                    Image(systemName: "minus.circle")
                        .font(.system(size: 13))
                }
                .buttonStyle(.plain)
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .help("Remove \(label.lowercased())")
                .accessibilityLabel("Remove \(label.lowercased())")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
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
