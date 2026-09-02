import AntimatterFoundation
import Foundation

@MainActor
final class ComposerViewModel: ObservableObject {
    @Published var message = ""
    @Published var height: CGFloat
    @Published private(set) var isSending = false
    @Published private(set) var sendError: String?

    private let sender: MattermostPostSender
    private let defaults: UserDefaults
    private var channelID: String?
    private let draftsKey = "mattermostComposerDrafts"
    private let heightKey = "mattermostComposerHeight"

    init(session: MattermostSession, defaults: UserDefaults = .standard) {
        sender = MattermostPostSender(
            client: MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        )
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
                let post = try await sender.send(MattermostPostRequest(channelID: channelID, message: draft))
                message = ""
                removeDraft(for: channelID)
                onSent(post)
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

    private var drafts: [String: String] {
        defaults.dictionary(forKey: draftsKey) as? [String: String] ?? [:]
    }

    private func removeDraft(for channelID: String) {
        var values = drafts
        values.removeValue(forKey: channelID)
        defaults.set(values, forKey: draftsKey)
    }
}
