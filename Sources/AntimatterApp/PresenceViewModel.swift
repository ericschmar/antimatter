import AntimatterFoundation
import Foundation

@MainActor
final class PresenceViewModel: ObservableObject {
    @Published private(set) var typingUserIDs: Set<String> = []
    @Published private(set) var statuses: [String: String] = [:]

    private var expiryTasks: [String: Task<Void, Never>] = [:]

    func reconcile(_ event: MattermostWebSocketEvent, channelID: String?) {
        switch event.event {
        case "typing":
            guard event.data?["channel_id"]?.stringValue == channelID,
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

    var typingLabel: String? {
        guard !typingUserIDs.isEmpty else { return nil }
        return typingUserIDs.count == 1 ? "Someone is typing" : "\(typingUserIDs.count) people are typing"
    }
}
