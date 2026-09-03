import Foundation

public struct MattermostTeam: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let displayName: String

    enum CodingKeys: String, CodingKey {
        case id, name
        case displayName = "display_name"
    }
}

public struct MattermostChannel: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let displayName: String
    public let type: String
    public let deleteAt: Int64
    public var unreadCount: Int
    public var mentionCount: Int

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
        displayName = (try values.decodeIfPresent(String.self, forKey: .displayName))?.nonEmpty ?? name
        type = try values.decode(String.self, forKey: .type)
        deleteAt = try values.decodeIfPresent(Int64.self, forKey: .deleteAt) ?? 0
        unreadCount = try values.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
        mentionCount = try values.decodeIfPresent(Int.self, forKey: .mentionCount) ?? 0
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(name, forKey: .name)
        try values.encode(displayName, forKey: .displayName)
        try values.encode(type, forKey: .type)
        try values.encode(deleteAt, forKey: .deleteAt)
        try values.encode(unreadCount, forKey: .unreadCount)
        try values.encode(mentionCount, forKey: .mentionCount)
    }
}

public struct MattermostNavigationSnapshot: Sendable {
    public let teams: [MattermostTeam]
    public let channels: [MattermostChannel]
    public let users: [MattermostUser]
    public let currentUserID: String
}

public actor MattermostNavigationLoader {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func load() async throws -> MattermostNavigationSnapshot {
        async let teams: [MattermostTeam] = client.get("/api/v4/users/me/teams")
        async let channels: [MattermostChannel] = client.get("/api/v4/users/me/channels")
        async let currentUser: MattermostUser = client.get("/api/v4/users/me")
        let loadedChannels = try await channels
        let me = try? await currentUser
        let directUserIDs = Set(
            loadedChannels
                .filter { $0.type == "D" }
                .flatMap { $0.name.split(separator: "_").map(String.init) }
                .filter { !$0.isEmpty && $0 != me?.id }
        )
        let directUsers: [MattermostUser]
        if directUserIDs.isEmpty {
            directUsers = []
        } else {
            directUsers = (try? await client.post(
                "/api/v4/users/ids",
                body: Array(directUserIDs)
            )) ?? []
        }
        return try await MattermostNavigationSnapshot(
            teams: teams,
            channels: loadedChannels,
            users: (me.map { [$0] } ?? []) + directUsers,
            currentUserID: me?.id ?? ""
        )
    }

    public func loadAvatarData(userID: String) async throws -> Data {
        try await client.getData("/api/v4/users/\(userID)/image")
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
