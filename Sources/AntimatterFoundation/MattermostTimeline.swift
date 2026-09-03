import Foundation

public struct MattermostPostList: Decodable, Sendable {
    public let order: [String]
    public let posts: [String: MattermostPost]

    public init(order: [String], posts: [String: MattermostPost]) {
        self.order = order
        self.posts = posts
    }

    public var orderedPosts: [MattermostPost] {
        let ordered = order.compactMap { posts[$0] }
        guard ordered.count == posts.count else {
            return ordered + posts.values.filter { post in !order.contains(post.id) }
        }
        return ordered
    }
}

public actor MattermostTimelineLoader {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func loadRecentPosts(channelID: String, page: MattermostPage = MattermostPage()) async throws -> [MattermostPost] {
        let response: MattermostPostList = try await client.getPage(
            "/api/v4/channels/\(channelID)/posts",
            page: page
        )
        return response.orderedPosts
    }

    public func loadUsers(ids: [String]) async throws -> [MattermostUser] {
        guard !ids.isEmpty else { return [] }
        return try await client.post("/api/v4/users/ids", body: ids)
    }

    public func loadAvatarData(userID: String) async throws -> Data {
        try await client.getData("/api/v4/users/\(userID)/image")
    }

    public func loadStatuses(userIDs: [String]) async throws -> [MattermostUserStatus] {
        guard !userIDs.isEmpty else { return [] }
        return try await client.post("/api/v4/users/status/ids", body: userIDs)
    }
}

public struct MattermostUserStatus: Decodable, Sendable {
    public let userID: String
    public let status: String

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case status
    }
}
