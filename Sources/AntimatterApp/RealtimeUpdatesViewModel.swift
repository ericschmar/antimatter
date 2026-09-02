import AntimatterFoundation
import Foundation

@MainActor
final class RealtimeUpdatesViewModel: ObservableObject {
    @Published private(set) var latestEvent: MattermostWebSocketEvent?

    private let socket: MattermostWebSocket
    private var eventTask: Task<Void, Never>?

    init(session: MattermostSession) {
        socket = MattermostWebSocket(serverURL: session.serverURL, token: session.token)
    }

    func start() async {
        guard eventTask == nil else { return }
        let events = await socket.events()
        eventTask = Task { [weak self] in
            for await event in events {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    self?.latestEvent = event
                }
            }
        }
        do {
            try await socket.connect()
        } catch {
            eventTask?.cancel()
            eventTask = nil
        }
    }

    func stop() async {
        eventTask?.cancel()
        eventTask = nil
        await socket.disconnect()
    }

    func sendTyping(channelID: String, parentID: String = "") async {
        try? await socket.send(MattermostTypingEvent(channelID: channelID, parentID: parentID))
    }
}
