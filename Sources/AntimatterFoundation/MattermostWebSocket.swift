import Foundation

public enum MattermostWebSocketValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case boolean(Bool)
    case object([String: MattermostWebSocketValue])
    case array([MattermostWebSocketValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(Bool.self) { self = .boolean(value) }
        else if let value = try? container.decode([String: MattermostWebSocketValue].self) { self = .object(value) }
        else { self = .array(try container.decode([MattermostWebSocketValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .boolean(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    public var intValue: Int? {
        switch self {
        case let .string(value): Int(value)
        case let .number(value): Int(value)
        default: nil
        }
    }
}

public struct MattermostWebSocketEvent: Decodable, Equatable, Sendable {
    public let event: String
    public let data: [String: MattermostWebSocketValue]?
    public let seq: Int?

    public func decodedData<Value: Decodable>(_ type: Value.Type, forKey key: String) -> Value? {
        guard let value = data?[key] else { return nil }
        let data: Data?
        if let string = value.stringValue {
            data = string.data(using: .utf8)
        } else {
            data = try? JSONEncoder().encode(value)
        }
        return data.flatMap { try? JSONDecoder().decode(Value.self, from: $0) }
    }
}

public actor MattermostWebSocket {
    private let serverURL: URL
    private let token: String
    private let session: URLSession
    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<MattermostWebSocketEvent>.Continuation?
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private var heartbeatTask: Task<Void, Never>?
    private var nextSequence = 1

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
        reconnectTask = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        task?.cancel(with: .normalClosure, reason: nil)
        var request = URLRequest(url: Self.endpoint(for: serverURL))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        do {
            try await task.send(.data(try JSONEncoder().encode(AuthenticationChallenge(token: token, sequence: nextSequence))))
            nextSequence += 1
        } catch {
            guard self.task === task else { throw error }
            self.task = nil
            task.cancel(with: .normalClosure, reason: nil)
            throw error
        }
        reconnectAttempt = 0
        startHeartbeat(for: task)
        Task { [weak self, weak task] in
            guard let self, let task else { return }
            await self.receiveLoop(task)
        }
    }

    public func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        continuation?.finish()
        continuation = nil
    }

    public func send<Action: Encodable>(_ action: Action) async throws {
        guard let task else { throw MattermostAPIError.invalidResponse }
        let actionData = try JSONEncoder().encode(action)
        guard var payload = try JSONSerialization.jsonObject(with: actionData) as? [String: Any] else {
            throw MattermostAPIError.invalidResponse
        }
        payload["seq"] = nextSequence
        nextSequence += 1
        try await task.send(.data(try JSONSerialization.data(withJSONObject: payload)))
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
                guard task === receivingTask else { return }
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
                guard task === receivingTask else { return }
                task = nil
                stopHeartbeat()
                scheduleReconnect()
                return
            }
        }
    }

    private func scheduleReconnect() {
        guard task == nil, reconnectTask == nil else { return }
        let delay = min(pow(2, Double(reconnectAttempt)), 30)
        reconnectAttempt += 1
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.clearReconnectTask()
            do {
                try await self?.connect()
            } catch {
                await self?.scheduleReconnect()
            }
        }
    }

    private func clearReconnectTask() {
        reconnectTask = nil
    }

    private func startHeartbeat(for heartbeatTask: URLSessionWebSocketTask) {
        self.heartbeatTask?.cancel()
        self.heartbeatTask = Task { [weak self, weak heartbeatTask] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { return }
                guard let heartbeatTask else { return }
                await self?.sendHeartbeat(to: heartbeatTask)
            }
        }
    }

    private func stopHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = nil
    }

    private func sendHeartbeat(to heartbeatTask: URLSessionWebSocketTask) async {
        guard task === heartbeatTask else { return }
        do {
            try await heartbeatTask.send(.data(try JSONEncoder().encode(WebSocketPing(sequence: nextSequence))))
            nextSequence += 1
        } catch {
            guard task === heartbeatTask else { return }
            task = nil
            heartbeatTask.cancel(with: .normalClosure, reason: nil)
            stopHeartbeat()
            scheduleReconnect()
        }
    }
}

private struct AuthenticationChallenge: Encodable {
    let seq: Int
    let action = "authentication_challenge"
    let data: [String: String]

    init(token: String, sequence: Int) {
        seq = sequence
        data = ["token": token]
    }
}

private struct WebSocketPing: Encodable {
    let seq: Int
    let action = "ping"

    init(sequence: Int) {
        seq = sequence
    }
}

public struct MattermostTypingEvent: Encodable, Sendable {
    public let action = "user_typing"
    public let data: Payload

    public init(channelID: String, parentID: String = "") {
        data = Payload(channelID: channelID, parentID: parentID)
    }

    public struct Payload: Encodable, Sendable {
        let channelID: String
        let parentID: String

        enum CodingKeys: String, CodingKey {
            case channelID = "channel_id"
            case parentID = "parent_id"
        }
    }
}
