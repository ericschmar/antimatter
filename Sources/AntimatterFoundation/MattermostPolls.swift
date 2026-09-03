import Foundation

/// The post shape emitted by the Matterpoll plugin.
///
/// Mattermost itself has no native polls endpoint; Matterpoll exposes polls as
/// `custom_matterpoll` posts and uses the standard post-action API for votes.
public struct MattermostPoll: Codable, Equatable, Sendable {
    public static let postType = "custom_matterpoll"

    public let pollID: String?
    public let attachments: [MattermostPollAttachment]

    enum CodingKeys: String, CodingKey {
        case pollID = "poll_id"
        case attachments
    }

    public var attachment: MattermostPollAttachment? { attachments.first }
}

public struct MattermostPollAttachment: Codable, Equatable, Sendable {
    public let title: String?
    public let text: String?
    public let actions: [MattermostPollAction]
}

public struct MattermostPollAction: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let type: String?

    public var voteCount: Int {
        guard let range = name.range(of: #" \(([0-9]+)\)$"#, options: .regularExpression) else { return 0 }
        return Int(name[range].dropFirst(2).dropLast()) ?? 0
    }

    public var option: String {
        name.replacingOccurrences(of: #" \([0-9]+\)$"#, with: "", options: .regularExpression)
    }

    public var isVote: Bool { type == "button" && !["addOption", "endPoll", "deletePoll"].contains(id) }
}

public struct MattermostPollCommand: Codable, Sendable {
    public let channelID: String
    public let command: String

    enum CodingKeys: String, CodingKey {
        case channelID = "channel_id"
        case command
    }
}

public struct MattermostCommandResponse: Decodable, Sendable {
    public let triggerID: String?

    enum CodingKeys: String, CodingKey {
        case triggerID = "trigger_id"
    }
}

public actor MattermostPolls {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    /// Creates a Matterpoll poll by executing its registered `/poll` command.
    public func create(channelID: String, question: String, options: [String]) async throws {
        let quoted = ([question] + options).map { "\"\($0.replacingOccurrences(of: "\"", with: "\\\""))\"" }
        let command = "/poll " + quoted.joined(separator: " ")
        let _: MattermostCommandResponse = try await client.post(
            "/api/v4/commands/execute",
            body: MattermostPollCommand(channelID: channelID, command: command)
        )
    }

    /// Votes through the Mattermost post-action API used by the Matterpoll plugin.
    public func vote(postID: String, actionID: String) async throws {
        let _: MattermostCommandResponse = try await client.post(
            "/api/v4/posts/\(postID)/actions/\(actionID)",
            body: EmptyRequest()
        )
    }
}

private struct EmptyRequest: Encodable, Sendable {}
