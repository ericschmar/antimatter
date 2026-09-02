import Foundation

public struct MattermostPostRequest: Encodable, Sendable {
    public let channelID: String
    public let message: String
    public let fileIDs: [String]
    public let rootID: String

    public init(channelID: String, message: String, fileIDs: [String] = [], rootID: String = "") {
        self.channelID = channelID
        self.message = message
        self.fileIDs = fileIDs
        self.rootID = rootID
    }

    enum CodingKeys: String, CodingKey {
        case channelID = "channel_id"
        case message
        case fileIDs = "file_ids"
        case rootID = "root_id"
    }
}

public struct MattermostPostUpdate: Encodable, Sendable {
    public let id: String
    public let message: String

    public init(id: String, message: String) {
        self.id = id
        self.message = message
    }
}

public actor MattermostPostSender {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func send(_ request: MattermostPostRequest) async throws -> MattermostPost {
        try await client.post("/api/v4/posts", body: request)
    }

    public func update(_ update: MattermostPostUpdate) async throws -> MattermostPost {
        try await client.put("/api/v4/posts/\(update.id)", body: update)
    }
}
