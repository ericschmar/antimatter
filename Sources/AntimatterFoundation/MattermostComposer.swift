import Foundation

public struct MattermostPostRequest: Encodable, Sendable {
    public let channelID: String
    public let message: String
    public let fileIDs: [String]

    public init(channelID: String, message: String, fileIDs: [String] = []) {
        self.channelID = channelID
        self.message = message
        self.fileIDs = fileIDs
    }

    enum CodingKeys: String, CodingKey {
        case channelID = "channel_id"
        case message
        case fileIDs = "file_ids"
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
}
