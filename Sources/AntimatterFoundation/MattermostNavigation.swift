import Foundation

public struct MattermostTeam: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let displayName: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case displayName = "display_name"
    }
}

public struct MattermostChannel: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let displayName: String
    public let type: String
    public let deleteAt: Int64
    public let unreadCount: Int
    public let mentionCount: Int

    enum CodingKeys: String, CodingKey {
        case id, name, type
        case displayName = "display_name"
        case deleteAt = "delete_at"
        case unreadCount = "msg_count"
        case mentionCount = "mention_count"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        displayName = try values.decodeIfPresent(String.self, forKey: .displayName) ?? name
        type = try values.decode(String.self, forKey: .type)
        deleteAt = try values.decodeIfPresent(Int64.self, forKey: .deleteAt) ?? 0
        unreadCount = try values.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
        mentionCount = try values.decodeIfPresent(Int.self, forKey: .mentionCount) ?? 0
    }
}

public struct MattermostNavigationSnapshot: Sendable {
    public let teams: [MattermostTeam]
    public let channels: [MattermostChannel]
}

public actor MattermostNavigationLoader {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func load() async throws -> MattermostNavigationSnapshot {
        async let teams: [MattermostTeam] = client.get("/api/v4/users/me/teams")
        async let channels: [MattermostChannel] = client.get("/api/v4/users/me/channels")
        return try await MattermostNavigationSnapshot(teams: teams, channels: channels)
    }
}
