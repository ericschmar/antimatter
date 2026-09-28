import AntimatterFoundation
import Foundation

@MainActor
final class PresenceViewModel: ObservableObject {
    @Published private(set) var typingUserIDs: Set<String> = []
    @Published private(set) var statuses: [String: String] = [:]

    private let client: MattermostAPIClient
    private var expiryTasks: [String: Task<Void, Never>] = [:]

    init(session: MattermostSession) {
        client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
    }

    func refresh(for userIDs: Set<String>) async {
        guard !userIDs.isEmpty else { return }
        do {
            let refreshedStatuses: [MattermostUserStatus] = try await client.post(
                "/api/v4/users/status/ids",
                body: userIDs.sorted()
            )
            statuses.merge(
                Dictionary(uniqueKeysWithValues: refreshedStatuses.map { ($0.userID, $0.status) })
            ) { _, new in new }
        } catch {
            // Real-time status events continue to update indicators if this
            // best-effort initial snapshot is unavailable.
        }
    }

    func reconcile(_ event: MattermostWebSocketEvent, channelID: String?) {
        switch event.event {
        case "typing":
            // Current server versions put only user_id/parent_id in typing
            // `data`; the channel rides in `broadcast.channel_id`, which is
            // also what the hub routes by. Accept either location.
            let typingChannelID = event.data?["channel_id"]?.stringValue
                ?? event.broadcast?["channel_id"]?.stringValue
            guard typingChannelID == channelID,
                  let userID = event.data?["user_id"]?.stringValue else { return }
            typingUserIDs.insert(userID)
            expiryTasks[userID]?.cancel()
            expiryTasks[userID] = Task { [weak self] in
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { return }
                await MainActor.run { self?.typingUserIDs.remove(userID) }
            }
        case "status_change":
            guard let userID = event.data?["user_id"]?.stringValue,
                  let status = event.data?["status"]?.stringValue else { return }
            statuses[userID] = status
        default:
            return
        }
    }

    func clearTypingIndicators() {
        expiryTasks.values.forEach { $0.cancel() }
        expiryTasks.removeAll()
        typingUserIDs.removeAll()
    }

    var hasTypingUsers: Bool {
        !typingUserIDs.isEmpty
    }
}
