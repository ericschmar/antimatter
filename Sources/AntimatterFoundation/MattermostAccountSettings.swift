import Foundation

private struct EmptyResponse: Decodable, Sendable {}

public struct MattermostProfile: Codable, Equatable, Sendable {
    public let id: String
    public let username: String
    public let email: String
    public let firstName: String
    public let lastName: String
    public let nickname: String

    enum CodingKeys: String, CodingKey {
        case id, username, email, nickname
        case firstName = "first_name"
        case lastName = "last_name"
    }

    public init(
        id: String,
        username: String,
        email: String,
        firstName: String = "",
        lastName: String = "",
        nickname: String = ""
    ) {
        self.id = id
        self.username = username
        self.email = email
        self.firstName = firstName
        self.lastName = lastName
        self.nickname = nickname
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        username = try values.decodeIfPresent(String.self, forKey: .username) ?? ""
        email = try values.decodeIfPresent(String.self, forKey: .email) ?? ""
        firstName = try values.decodeIfPresent(String.self, forKey: .firstName) ?? ""
        lastName = try values.decodeIfPresent(String.self, forKey: .lastName) ?? ""
        nickname = try values.decodeIfPresent(String.self, forKey: .nickname) ?? ""
    }
}

public struct MattermostProfilePatch: Encodable, Sendable {
    public var email: String?
    public var username: String?
    public var firstName: String?
    public var lastName: String?
    public var nickname: String?

    public init(
        email: String? = nil,
        username: String? = nil,
        firstName: String? = nil,
        lastName: String? = nil,
        nickname: String? = nil
    ) {
        self.email = email
        self.username = username
        self.firstName = firstName
        self.lastName = lastName
        self.nickname = nickname
    }

    enum CodingKeys: String, CodingKey {
        case email, username, nickname
        case firstName = "first_name"
        case lastName = "last_name"
    }
}

public struct MattermostUserStatusUpdate: Encodable, Sendable {
    public let status: String

    public init(status: String) {
        self.status = status
    }
}

public struct MattermostCustomStatus: Codable, Equatable, Sendable {
    public let emoji: String
    public let text: String
    public let duration: String

    public init(emoji: String, text: String, duration: String = "dont_clear") {
        self.emoji = emoji
        self.text = text
        self.duration = duration
    }
}

public struct MattermostPasswordChange: Encodable, Sendable {
    public let currentPassword: String
    public let newPassword: String

    public init(currentPassword: String, newPassword: String) {
        self.currentPassword = currentPassword
        self.newPassword = newPassword
    }

    enum CodingKeys: String, CodingKey {
        case currentPassword = "current_password"
        case newPassword = "new_password"
    }
}

public struct MattermostPreference: Codable, Equatable, Sendable {
    public let userID: String
    public let category: String
    public let name: String
    public let value: String

    public init(userID: String, category: String, name: String, value: String) {
        self.userID = userID
        self.category = category
        self.name = name
        self.value = value
    }

    enum CodingKeys: String, CodingKey {
        case category, name, value
        case userID = "user_id"
    }
}

public actor MattermostAccountSettings {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func loadProfile() async throws -> MattermostProfile {
        try await client.get("/api/v4/users/me")
    }

    public func updateProfile(_ userID: String, patch: MattermostProfilePatch) async throws -> MattermostProfile {
        try await client.put("/api/v4/users/\(userID)/patch", body: patch)
    }

    public func uploadProfileImage(_ data: Data, userID: String) async throws -> MattermostProfile {
        let boundary = "Antimatter-\(UUID().uuidString)"
        var body = Data("--\(boundary)\r\n".utf8)
        body.append(Data("Content-Disposition: form-data; name=\"image\"; filename=\"profile.png\"\r\n".utf8))
        body.append(Data("Content-Type: image/png\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return try await client.postMultipart("/api/v4/users/\(userID)/image", body: body, boundary: boundary)
    }

    public func updateStatus(_ status: String, userID: String) async throws {
        let _: EmptyResponse = try await client.put(
            "/api/v4/users/\(userID)/status",
            body: MattermostUserStatusUpdate(status: status)
        )
    }

    public func updateCustomStatus(_ customStatus: MattermostCustomStatus, userID: String) async throws {
        let _: EmptyResponse = try await client.put(
            "/api/v4/users/\(userID)/status/custom",
            body: customStatus
        )
    }

    public func changePassword(_ password: MattermostPasswordChange, userID: String) async throws {
        let _: EmptyResponse = try await client.put(
            "/api/v4/users/\(userID)/password",
            body: password
        )
    }

    public func loadNotificationPreferences(userID: String) async throws -> [MattermostPreference] {
        try await client.get("/api/v4/users/\(userID)/preferences")
    }

    public func saveNotificationPreferences(
        _ preferences: [MattermostPreference],
        userID: String
    ) async throws -> [MattermostPreference] {
        try await client.put("/api/v4/users/\(userID)/preferences", body: preferences)
    }
}
