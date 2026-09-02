import Foundation

public struct MattermostCurrentUser: Decodable, Sendable {
    public let id: String
}

public actor MattermostReactions {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func currentUserID() async throws -> String {
        let user: MattermostCurrentUser = try await client.get("/api/v4/users/me")
        return user.id
    }

    public func add(postID: String, emojiName: String, userID: String) async throws {
        let _: MattermostReaction = try await client.post(
            "/api/v4/reactions",
            body: MattermostReaction(userID: userID, postID: postID, emojiName: emojiName)
        )
    }

    public func remove(postID: String, emojiName: String, userID: String) async throws {
        let _: EmptyResponse = try await client.delete(
            "/api/v4/users/\(userID)/posts/\(postID)/reactions/\(emojiName)"
        )
    }
}

private struct EmptyResponse: Decodable, Sendable {}
