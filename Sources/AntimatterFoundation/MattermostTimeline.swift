import Foundation

public struct MattermostTimelineGrouping: Sendable {
    public let maximumInterval: TimeInterval

    public init(maximumInterval: TimeInterval) {
        self.maximumInterval = maximumInterval
    }

    public func shouldGroup(_ post: MattermostPost, with previousPost: MattermostPost?) -> Bool {
        guard
            maximumInterval > 0,
            let previousPost,
            post.userID == previousPost.userID
        else {
            return false
        }

        let interval = TimeInterval(post.createAt - previousPost.createAt) / 1_000
        return interval >= 0 && interval <= maximumInterval
    }
}

public enum MattermostMentionMatcher {
    public static func containsHighlightableMention(in message: String, username: String?) -> Bool {
        let usernames = ["here"] + (username.map { [$0] } ?? [])
        return usernames.contains { username in
            containsMention(in: message, username: username)
        }
    }

    private static func containsMention(in message: String, username: String) -> Bool {
        guard !username.isEmpty else { return false }

        let mention = "@\(username)"
        var searchRange = message.startIndex..<message.endIndex
        while let range = message.range(
            of: mention,
            options: [.caseInsensitive],
            range: searchRange
        ) {
            let precedingCharacter = range.lowerBound > message.startIndex
                ? message[message.index(before: range.lowerBound)]
                : nil

            if !isMentionIdentifierCharacter(precedingCharacter),
               isMentionTerminator(in: message, after: range.upperBound) {
                return true
            }
            searchRange = range.upperBound..<message.endIndex
        }
        return false
    }

    private static func isMentionIdentifierCharacter(_ character: Character?) -> Bool {
        guard let character else { return false }
        return character.isLetter || character.isNumber || character == "_" || character == "-" || character == "."
    }

    private static func isMentionTerminator(in message: String, after index: String.Index) -> Bool {
        guard index < message.endIndex else { return true }
        guard message[index] == "." else {
            return !isMentionIdentifierCharacter(message[index])
        }

        let nextIndex = message.index(after: index)
        return nextIndex == message.endIndex || !isMentionIdentifierCharacter(message[nextIndex])
    }
}

public struct MattermostTimelineThread: Identifiable, Sendable {
    public let root: MattermostPost
    public let replies: [MattermostPost]

    public init(root: MattermostPost, replies: [MattermostPost]) {
        self.root = root
        self.replies = replies
    }

    public var id: String { root.id }
}

public enum MattermostTimelineThreading {
    public static func threads(from posts: [MattermostPost]) -> [MattermostTimelineThread] {
        let posts = posts.sorted { $0.createAt < $1.createAt }
        let rootPostIDs = Set(posts.lazy.filter(\.rootID.isEmpty).map(\.id))
        var repliesByRootID: [String: [MattermostPost]] = [:]
        var roots: [MattermostPost] = []

        for post in posts {
            guard !post.rootID.isEmpty, rootPostIDs.contains(post.rootID) else {
                roots.append(post)
                continue
            }
            repliesByRootID[post.rootID, default: []].append(post)
        }

        return roots.map { root in
            MattermostTimelineThread(root: root, replies: repliesByRootID[root.id] ?? [])
        }
    }
}

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

    public func loadFileData(fileID: String) async throws -> Data {
        try await client.getData("/api/v4/files/\(fileID)")
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
