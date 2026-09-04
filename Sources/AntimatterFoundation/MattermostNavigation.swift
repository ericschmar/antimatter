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
    public let teamID: String
    public let name: String
    public let displayName: String
    public let description: String
    public let type: String
    public let deleteAt: Int64
    public var lastPostAt: Int64
    public var unreadCount: Int
    public var mentionCount: Int

    enum CodingKeys: String, CodingKey {
        case id, name, type, description
        case teamID = "team_id"
        case displayName = "display_name"
        case deleteAt = "delete_at"
        case lastPostAt = "last_post_at"
        case unreadCount = "msg_count"
        case mentionCount = "mention_count"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        teamID = try values.decodeIfPresent(String.self, forKey: .teamID) ?? ""
        name = try values.decode(String.self, forKey: .name)
        displayName = (try values.decodeIfPresent(String.self, forKey: .displayName))?.nonEmpty ?? name
        description = try values.decodeIfPresent(String.self, forKey: .description) ?? ""
        type = try values.decode(String.self, forKey: .type)
        deleteAt = try values.decodeIfPresent(Int64.self, forKey: .deleteAt) ?? 0
        lastPostAt = try values.decodeIfPresent(Int64.self, forKey: .lastPostAt) ?? 0
        unreadCount = try values.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
        mentionCount = try values.decodeIfPresent(Int.self, forKey: .mentionCount) ?? 0
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(teamID, forKey: .teamID)
        try values.encode(name, forKey: .name)
        try values.encode(displayName, forKey: .displayName)
        try values.encode(description, forKey: .description)
        try values.encode(type, forKey: .type)
        try values.encode(deleteAt, forKey: .deleteAt)
        try values.encode(lastPostAt, forKey: .lastPostAt)
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

    public func createDirectChannel(userIDs: [String]) async throws -> MattermostChannel {
        try await client.post("/api/v4/channels/direct", body: userIDs)
    }

    public func loadTeamUsers(teamID: String) async throws -> [MattermostUser] {
        try await client.get("/api/v4/teams/\(teamID)/users?page=0&per_page=200")
    }

    public func createChannel(
        teamID: String,
        name: String,
        displayName: String,
        purpose: String,
        type: String
    ) async throws -> MattermostChannel {
        try await client.post(
            "/api/v4/channels",
            body: CreateChannelRequest(
                teamID: teamID,
                name: name,
                displayName: displayName,
                purpose: purpose,
                type: type
            )
        )
    }

    public func addMember(userID: String, to channelID: String) async throws {
        let _: EmptyResponse = try await client.post(
            "/api/v4/channels/\(channelID)/members",
            body: AddChannelMemberRequest(userID: userID)
        )
    }

    public func loadMembers(channelID: String) async throws -> [MattermostUser] {
        var memberIDs: [String] = []
        var page = 0

        while true {
            let members: [MattermostChannelMember] = try await client.getPage(
                "/api/v4/channels/\(channelID)/members",
                page: MattermostPage(index: page, size: 200)
            )
            memberIDs.append(contentsOf: members.map(\.userID))
            guard members.count == 200 else { break }
            page += 1
        }

        return try await withThrowingTaskGroup(of: [MattermostUser].self, returning: [MattermostUser].self) { group in
            for userIDs in memberIDs.chunked(into: 200) {
                group.addTask {
                    try await self.client.post("/api/v4/users/ids", body: userIDs)
                }
            }
            var users: [MattermostUser] = []
            for try await batch in group {
                users.append(contentsOf: batch)
            }
            return users.sorted {
                $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending
            }
        }
    }

    public func viewChannel(channelID: String, previousChannelID: String?) async throws {
        let _: EmptyResponse = try await client.post(
            "/api/v4/channels/\(channelID)/view",
            body: ChannelViewRequest(channelID: channelID, previousChannelID: previousChannelID)
        )
    }
}

private struct CreateChannelRequest: Encodable, Sendable {
    let teamID: String
    let name: String
    let displayName: String
    let purpose: String
    let type: String

    enum CodingKeys: String, CodingKey {
        case name, purpose, type
        case teamID = "team_id"
        case displayName = "display_name"
    }
}

private struct AddChannelMemberRequest: Encodable, Sendable {
    let userID: String

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
    }
}

private struct ChannelViewRequest: Encodable, Sendable {
    let channelID: String
    let previousChannelID: String?

    enum CodingKeys: String, CodingKey {
        case channelID = "channel_id"
        case previousChannelID = "prev_channel_id"
    }
}

private struct MattermostChannelMember: Decodable, Sendable {
    let userID: String

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
    }
}

private struct EmptyResponse: Decodable, Sendable {}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0 ..< Swift.min($0 + size, count)])
        }
    }
}
