import AntimatterFoundation
import Foundation
import XCTest

final class MattermostLocalStoreTests: XCTestCase {
    func testUserDecodesMattermostProfileName() throws {
        let user = try decode(MattermostUser.self, from: """
        {"id":"user-1","username":"ada","first_name":"Ada","last_name":"Lovelace"}
        """)

        XCTAssertEqual(user.displayName, "Ada Lovelace")
    }

    func testPostDecodesWebhookAuthorAndAttachments() throws {
        let post = try decode(MattermostPost.self, from: """
        {
          "id": "post-1",
          "channel_id": "channel-1",
          "user_id": "user-1",
          "message": "",
          "create_at": 1,
          "update_at": 1,
          "props": {
            "override_username": "livit-appconsole",
            "attachments": [{
              "title": "Appconsole Deployment Started",
              "text": "Application ezid2 3.38.2 deployment to Play Framework (EKS) - DEV initiated by Christopher V Dalisay (dalisay2)"
            }]
          }
        }
        """)

        XCTAssertEqual(post.overrideUsername, "livit-appconsole")
        XCTAssertEqual(
            post.message,
            "**Appconsole Deployment Started**\n```text\nApplication ezid2 3.38.2 deployment to Play Framework (EKS) - DEV initiated by Christopher V Dalisay (dalisay2)\n```"
        )
    }

    func testStorePersistsNavigationAndReconcilesUpdatedPosts() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }

        let serverURL = try XCTUnwrap(URL(string: "https://chat.example.com"))
        let store = MattermostLocalStore(serverURL: serverURL, directory: directory)
        let team = try decode(MattermostTeam.self, from: """
        {"id":"team-1","name":"engineering","display_name":"Engineering"}
        """)
        let channel = try decode(MattermostChannel.self, from: """
        {"id":"channel-1","name":"native","display_name":"Native","type":"O"}
        """)
        let original = MattermostPost(
            id: "post-1", channelID: "channel-1", userID: "user-1",
            message: "First version", createAt: 1, updateAt: 1
        )
        let updated = MattermostPost(
            id: "post-1", channelID: "channel-1", userID: "user-1",
            message: "Updated version", createAt: 1, updateAt: 2
        )

        try await store.apply(.navigation(teams: [team], channels: [channel]))
        try await store.apply(.selectedTeam(id: team.id))
        try await store.apply(.posts([original]))
        try await store.apply(.posts([updated]))

        let restored = try await MattermostLocalStore(serverURL: serverURL, directory: directory).load()
        XCTAssertEqual(restored.teams, [team])
        XCTAssertEqual(restored.channels, [channel])
        XCTAssertEqual(restored.selectedTeamID, team.id)
        XCTAssertEqual(restored.posts, [updated])
    }

    private func decode<Value: Decodable>(_ type: Value.Type, from value: String) throws -> Value {
        try JSONDecoder().decode(type, from: Data(value.utf8))
    }
}
