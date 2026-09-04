import Foundation

public struct MattermostCustomEmoji: Decodable, Equatable, Sendable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public actor MattermostCustomEmojiLoader {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func loadAll() async throws -> [MattermostCustomEmoji] {
        var pageIndex = 0
        var emojis: [MattermostCustomEmoji] = []

        while true {
            let page: [MattermostCustomEmoji] = try await client.getPage(
                "/api/v4/emoji",
                page: MattermostPage(index: pageIndex, size: 200)
            )
            emojis += page
            guard page.count == 200 else { return emojis }
            pageIndex += 1
        }
    }

    public func loadImageData(emojiID: String) async throws -> Data {
        try await client.getData("/api/v4/emoji/\(emojiID)/image")
    }
}
