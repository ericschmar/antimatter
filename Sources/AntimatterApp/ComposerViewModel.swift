import AntimatterFoundation
import Foundation

@MainActor
final class ComposerViewModel: ObservableObject {
    @Published var message = ""
    @Published var height: CGFloat
    @Published private(set) var attachmentURLs: [URL] = []
    @Published private(set) var isSending = false
    @Published private(set) var sendError: String?
    @Published private(set) var replyRootID: String?
    @Published private(set) var replyPost: MattermostPost?
    @Published private(set) var mentionableUsers: [MattermostUser] = []

    private let sender: MattermostPostSender
    private let polls: MattermostPolls
    private let navigation: MattermostNavigationLoader
    private let defaults: UserDefaults
    private var channelID: String?
    private var teamID = ""
    private let draftsKey = "mattermostComposerDrafts"
    private let heightKey = "mattermostComposerHeight"

    init(session: MattermostSession, defaults: UserDefaults = .standard) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        sender = MattermostPostSender(client: client)
        polls = MattermostPolls(client: client)
        navigation = MattermostNavigationLoader(client: client)
        self.defaults = defaults
        height = max(80, defaults.double(forKey: heightKey))
    }

    func select(channelID: String?, teamID: String? = nil) {
        persistDraft()
        self.channelID = channelID
        self.teamID = teamID ?? ""
        message = channelID.flatMap { drafts[$0] } ?? ""
        sendError = nil
        mentionableUsers = []
        guard let channelID else { return }
        Task {
            let users = (try? await navigation.loadMembers(channelID: channelID)) ?? []
            guard self.channelID == channelID else { return }
            mentionableUsers = users
        }
    }

    func send(onSent: @escaping (MattermostPost) -> Void) {
        guard let channelID, hasContent, !isSending else { return }
        let draft = messageWithAttachmentReferences
        isSending = true
        sendError = nil
        Task {
            do {
                let post = try await sender.send(MattermostPostRequest(channelID: channelID, message: draft, rootID: replyRootID ?? ""))
                message = ""
                attachmentURLs = []
                removeDraft(for: channelID)
                replyRootID = nil
                replyPost = nil
                onSent(post)
            } catch {
                sendError = error.localizedDescription
            }
            isSending = false
        }
    }

    func createPoll(question: String, options: [String]) {
        guard let channelID, !isSending else { return }
        isSending = true
        sendError = nil
        Task {
            do {
                try await polls.create(channelID: channelID, teamID: teamID, question: question, options: options)
            } catch {
                sendError = error.localizedDescription
            }
            isSending = false
        }
    }

    func persistDraft() {
        guard let channelID else { return }
        var values = drafts
        values[channelID] = message
        defaults.set(values, forKey: draftsKey)
    }

    func persistHeight() {
        defaults.set(height, forKey: heightKey)
    }

    func reply(to post: MattermostPost) {
        replyRootID = post.rootID.isEmpty ? post.id : post.rootID
        replyPost = post
    }

    func cancelReply() {
        replyRootID = nil
        replyPost = nil
    }

    func addAttachments(_ urls: [URL]) {
        attachmentURLs += urls.filter { url in !attachmentURLs.contains(url) }
    }

    func removeAttachment(_ url: URL) {
        attachmentURLs.removeAll { $0 == url }
    }

    func insertMention(_ username: String) {
        let mention = "@\(username) "
        let start = message.lastIndex(where: \.isWhitespace)
            .map { message.index(after: $0) } ?? message.startIndex
        guard message[start...].hasPrefix("@") else {
            message += mention
            return
        }
        message.replaceSubrange(start..., with: mention)
    }

    private var drafts: [String: String] {
        defaults.dictionary(forKey: draftsKey) as? [String: String] ?? [:]
    }

    var hasContent: Bool {
        !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachmentURLs.isEmpty
    }

    private var messageWithAttachmentReferences: String {
        let references = attachmentURLs
            .map { "[\($0.lastPathComponent)](\($0.absoluteString))" }
            .joined(separator: "\n")
        guard !references.isEmpty else { return message }
        guard !message.isEmpty else { return references }
        return "\(message)\n\(references)"
    }

    private func removeDraft(for channelID: String) {
        var values = drafts
        values.removeValue(forKey: channelID)
        defaults.set(values, forKey: draftsKey)
    }
}
