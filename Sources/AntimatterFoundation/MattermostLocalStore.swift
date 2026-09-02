import Foundation

public struct MattermostUser: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let username: String
    public let displayName: String

    public init(id: String, username: String, displayName: String) {
        self.id = id
        self.username = username
        self.displayName = displayName
    }
}

public struct MattermostPost: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let channelID: String
    public let userID: String
    public let message: String
    public let createAt: Int64
    public let updateAt: Int64

    public init(id: String, channelID: String, userID: String, message: String, createAt: Int64, updateAt: Int64) {
        self.id = id
        self.channelID = channelID
        self.userID = userID
        self.message = message
        self.createAt = createAt
        self.updateAt = updateAt
    }

    enum CodingKeys: String, CodingKey {
        case id, message
        case channelID = "channel_id"
        case userID = "user_id"
        case createAt = "create_at"
        case updateAt = "update_at"
    }
}

public struct MattermostUnreadState: Codable, Equatable, Sendable {
    public let channelID: String
    public let messageCount: Int
    public let mentionCount: Int

    public init(channelID: String, messageCount: Int, mentionCount: Int) {
        self.channelID = channelID
        self.messageCount = messageCount
        self.mentionCount = mentionCount
    }
}

public struct MattermostPreferences: Codable, Equatable, Sendable {
    public var values: [String: String]

    public init(values: [String: String] = [:]) {
        self.values = values
    }
}

public struct MattermostStoreSnapshot: Codable, Equatable, Sendable {
    public var teams: [MattermostTeam]
    public var channels: [MattermostChannel]
    public var users: [MattermostUser]
    public var posts: [MattermostPost]
    public var unread: [MattermostUnreadState]
    public var preferences: MattermostPreferences

    public init(
        teams: [MattermostTeam] = [],
        channels: [MattermostChannel] = [],
        users: [MattermostUser] = [],
        posts: [MattermostPost] = [],
        unread: [MattermostUnreadState] = [],
        preferences: MattermostPreferences = MattermostPreferences()
    ) {
        self.teams = teams
        self.channels = channels
        self.users = users
        self.posts = posts
        self.unread = unread
        self.preferences = preferences
    }
}

public enum MattermostStoreChange: Sendable {
    case navigation(teams: [MattermostTeam], channels: [MattermostChannel])
    case users([MattermostUser])
    case posts([MattermostPost])
    case removePost(id: String)
    case unread([MattermostUnreadState])
    case preferences(MattermostPreferences)
}

public actor MattermostLocalStore {
    private let fileURL: URL
    private let maximumCachedPosts = 2_000
    private var snapshot = MattermostStoreSnapshot()

    public init(serverURL: URL, directory: URL? = nil) {
        let cacheDirectory = directory ?? Self.defaultDirectory()
        let safeName = serverURL.host(percentEncoded: false)?.replacingOccurrences(of: ".", with: "_") ?? "server"
        fileURL = cacheDirectory.appending(path: "\(safeName)-store.json")
    }

    public func load() throws -> MattermostStoreSnapshot {
        guard FileManager.default.fileExists(atPath: fileURL.path()) else { return snapshot }
        snapshot = try JSONDecoder().decode(MattermostStoreSnapshot.self, from: Data(contentsOf: fileURL))
        return snapshot
    }

    public func currentSnapshot() -> MattermostStoreSnapshot {
        snapshot
    }

    public func apply(_ change: MattermostStoreChange) throws {
        switch change {
        case let .navigation(teams, channels):
            snapshot.teams = teams
            snapshot.channels = channels
        case let .users(users):
            snapshot.users = merged(users, into: snapshot.users, id: \.id)
        case let .posts(posts):
            snapshot.posts = Array(
                merged(posts, into: snapshot.posts, id: \.id)
                    .sorted { $0.createAt > $1.createAt }
                    .prefix(maximumCachedPosts)
            )
        case let .removePost(id):
            snapshot.posts.removeAll { $0.id == id }
        case let .unread(unread):
            snapshot.unread = unread
        case let .preferences(preferences):
            snapshot.preferences = preferences
        }
        try persist()
    }

    public func reconcile(_ event: MattermostWebSocketEvent) throws {
        guard event.event == "posted", let encodedPost = event.data?["post"]?.data(using: .utf8) else { return }
        try apply(.posts([try JSONDecoder().decode(MattermostPost.self, from: encodedPost)]))
    }

    private func persist() throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(snapshot).write(to: fileURL, options: .atomic)
    }

    private func merged<Value>(_ newValues: [Value], into current: [Value], id: KeyPath<Value, String>) -> [Value] {
        var values = Dictionary(uniqueKeysWithValues: current.map { ($0[keyPath: id], $0) })
        newValues.forEach { values[$0[keyPath: id]] = $0 }
        return Array(values.values)
    }

    private static func defaultDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "Antimatter/Cache")
    }
}
