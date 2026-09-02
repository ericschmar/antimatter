import Foundation

public struct MattermostWebSocketEvent: Decodable, Sendable {
    public let event: String
    public let data: [String: String]?
    public let seq: Int?
}

public actor MattermostWebSocket {
    private let serverURL: URL
    private let token: String
    private let session: URLSession
    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<MattermostWebSocketEvent>.Continuation?
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?

    public init(serverURL: URL, token: String, session: URLSession = .shared) {
        self.serverURL = serverURL
        self.token = token
        self.session = session
    }

    public func events() -> AsyncStream<MattermostWebSocketEvent> {
        AsyncStream { continuation in
            self.continuation = continuation
            continuation.onTermination = { [weak self] _ in
                Task { await self?.disconnect() }
            }
        }
    }

    public func connect() async throws {
        reconnectTask?.cancel()
        let task = session.webSocketTask(with: Self.endpoint(for: serverURL))
        self.task = task
        task.resume()
        try await task.send(.data(try JSONEncoder().encode(AuthenticationChallenge(token: token))))
        reconnectAttempt = 0
        Task { [weak self, weak task] in
            guard let self, let task else { return }
            await self.receiveLoop(task)
        }
    }

    public func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        continuation?.finish()
        continuation = nil
    }

    public static func endpoint(for serverURL: URL) -> URL {
        var components = URLComponents(url: URL(string: "/api/v4/websocket", relativeTo: serverURL)!.absoluteURL, resolvingAgainstBaseURL: false)!
        components.scheme = serverURL.scheme == "https" ? "wss" : "ws"
        return components.url!
    }

    private func receiveLoop(_ receivingTask: URLSessionWebSocketTask) async {
        while task === receivingTask {
            do {
                let message = try await receivingTask.receive()
                let data: Data
                switch message {
                case let .data(value): data = value
                case let .string(value): data = Data(value.utf8)
                @unknown default: continue
                }
                if let event = try? JSONDecoder().decode(MattermostWebSocketEvent.self, from: data) {
                    continuation?.yield(event)
                }
            } catch {
                scheduleReconnect()
                return
            }
        }
    }

    private func scheduleReconnect() {
        guard task != nil else { return }
        let delay = min(pow(2, Double(reconnectAttempt)), 30)
        reconnectAttempt += 1
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            do {
                try await self?.connect()
            } catch {
                await self?.scheduleReconnect()
            }
        }
    }
}

private struct AuthenticationChallenge: Encodable {
    let action = "authentication_challenge"
    let data: [String: String]

    init(token: String) {
        data = ["token": token]
    }
}
