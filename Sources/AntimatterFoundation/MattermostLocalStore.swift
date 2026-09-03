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

    enum CodingKeys: String, CodingKey {
        case id, username, nickname, displayName
        case firstName = "first_name"
        case lastName = "last_name"
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        username = try values.decodeIfPresent(String.self, forKey: .username) ?? id
        let fullName = [
            try values.decodeIfPresent(String.self, forKey: .firstName) ?? "",
            try values.decodeIfPresent(String.self, forKey: .lastName) ?? "",
        ]
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespaces)
        let nickname = try values.decodeIfPresent(String.self, forKey: .nickname)?
            .trimmingCharacters(in: .whitespaces) ?? ""
        let cachedDisplayName = try values.decodeIfPresent(String.self, forKey: .displayName)?
            .trimmingCharacters(in: .whitespaces) ?? ""
        displayName = fullName.isEmpty
            ? (nickname.isEmpty ? (cachedDisplayName.isEmpty ? username : cachedDisplayName) : nickname)
            : fullName
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(username, forKey: .username)
        try values.encode(displayName, forKey: .displayName)
    }
}

public struct MattermostPost: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let channelID: String
    public let userID: String
    public let message: String
    public let createAt: Int64
    public let updateAt: Int64
    public let rootID: String
    public let files: [MattermostFile]
    public let reactions: [MattermostReaction]

    public init(
        id: String,
        channelID: String,
        userID: String,
        message: String,
        createAt: Int64,
        updateAt: Int64,
        rootID: String = "",
        files: [MattermostFile] = [],
        reactions: [MattermostReaction] = []
    ) {
        self.id = id
        self.channelID = channelID
        self.userID = userID
        self.message = message
        self.createAt = createAt
        self.updateAt = updateAt
        self.rootID = rootID
        self.files = files
        self.reactions = reactions
    }

    enum CodingKeys: String, CodingKey {
        case id, message
        case channelID = "channel_id"
        case userID = "user_id"
        case createAt = "create_at"
        case updateAt = "update_at"
        case rootID = "root_id"
        case metadata
    }

    private enum MetadataCodingKeys: String, CodingKey {
        case files, reactions
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        channelID = try values.decode(String.self, forKey: .channelID)
        userID = try values.decode(String.self, forKey: .userID)
        message = try values.decodeIfPresent(String.self, forKey: .message) ?? ""
        createAt = try values.decodeIfPresent(Int64.self, forKey: .createAt) ?? 0
        updateAt = try values.decodeIfPresent(Int64.self, forKey: .updateAt) ?? createAt
        rootID = try values.decodeIfPresent(String.self, forKey: .rootID) ?? ""
        if values.contains(.metadata) {
            let metadata = try values.nestedContainer(keyedBy: MetadataCodingKeys.self, forKey: .metadata)
            files = try metadata.decodeIfPresent([MattermostFile].self, forKey: .files) ?? []
            reactions = try metadata.decodeIfPresent([MattermostReaction].self, forKey: .reactions) ?? []
        } else {
            files = []
            reactions = []
        }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(channelID, forKey: .channelID)
        try values.encode(userID, forKey: .userID)
        try values.encode(message, forKey: .message)
        try values.encode(createAt, forKey: .createAt)
        try values.encode(updateAt, forKey: .updateAt)
        try values.encode(rootID, forKey: .rootID)
        var metadata = values.nestedContainer(keyedBy: MetadataCodingKeys.self, forKey: .metadata)
        try metadata.encode(files, forKey: .files)
        try metadata.encode(reactions, forKey: .reactions)
    }
}

public struct MattermostFile: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let mimeType: String
    public let size: Int64

    enum CodingKeys: String, CodingKey {
        case id, name, size
        case mimeType = "mime_type"
    }
}

public struct MattermostReaction: Codable, Identifiable, Equatable, Sendable {
    public let userID: String
    public let postID: String
    public let emojiName: String

    public var id: String { "\(userID)-\(postID)-\(emojiName)" }

    public init(userID: String, postID: String, emojiName: String) {
        self.userID = userID
        self.postID = postID
        self.emojiName = emojiName
    }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case postID = "post_id"
        case emojiName = "emoji_name"
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
        switch event.event {
        case "posted", "post_edited":
            guard let post = event.decodedData(MattermostPost.self, forKey: "post") else { return }
            try apply(.posts([post]))
        case "post_deleted":
            guard let postID = event.data?["post_id"]?.stringValue else { return }
            try apply(.removePost(id: postID))
        case "reaction_added", "reaction_removed":
            guard let reaction = event.decodedData(MattermostReaction.self, forKey: "reaction"),
                  let post = snapshot.posts.first(where: { $0.id == reaction.postID }) else { return }
            let reactions = event.event == "reaction_added"
                ? post.reactions.filter { $0.id != reaction.id } + [reaction]
                : post.reactions.filter { $0.id != reaction.id }
            try apply(.posts([MattermostPost(
                id: post.id,
                channelID: post.channelID,
                userID: post.userID,
                message: post.message,
                createAt: post.createAt,
                updateAt: post.updateAt,
                files: post.files,
                reactions: reactions
            )]))
        default:
            return
        }
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
