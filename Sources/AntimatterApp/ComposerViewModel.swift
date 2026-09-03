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

    private let sender: MattermostPostSender
    private let polls: MattermostPolls
    private let defaults: UserDefaults
    private var channelID: String?
    private let draftsKey = "mattermostComposerDrafts"
    private let heightKey = "mattermostComposerHeight"

    init(session: MattermostSession, defaults: UserDefaults = .standard) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        sender = MattermostPostSender(client: client)
        polls = MattermostPolls(client: client)
        self.defaults = defaults
        height = max(80, defaults.double(forKey: heightKey))
    }

    func select(channelID: String?) {
        persistDraft()
        self.channelID = channelID
        message = channelID.flatMap { drafts[$0] } ?? ""
        sendError = nil
    }

    func send(onSent: @escaping (MattermostPost) -> Void) {
        guard let channelID, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !isSending else { return }
        let draft = message
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
                try await polls.create(channelID: channelID, question: question, options: options)
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
        let references = urls.map { "[\($0.lastPathComponent)](\($0.absoluteString))" }.joined(separator: "\n")
        message += message.isEmpty ? references : "\n\(references)"
    }

    func removeAttachment(_ url: URL) {
        attachmentURLs.removeAll { $0 == url }
        message = message.replacingOccurrences(of: "[\(url.lastPathComponent)](\(url.absoluteString))", with: "")
            .trimmingCharacters(in: .newlines)
    }

    private var drafts: [String: String] {
        defaults.dictionary(forKey: draftsKey) as? [String: String] ?? [:]
    }

    private func removeDraft(for channelID: String) {
        var values = drafts
        values.removeValue(forKey: channelID)
        defaults.set(values, forKey: draftsKey)
    }
}
