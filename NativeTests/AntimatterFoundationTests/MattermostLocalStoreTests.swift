import AntimatterFoundation
import Foundation
import XCTest

final class MattermostLocalStoreTests: XCTestCase {
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
        try await store.apply(.posts([original]))
        try await store.apply(.posts([updated]))

        let restored = try await MattermostLocalStore(serverURL: serverURL, directory: directory).load()
        XCTAssertEqual(restored.teams, [team])
        XCTAssertEqual(restored.channels, [channel])
        XCTAssertEqual(restored.posts, [updated])
    }

    private func decode<Value: Decodable>(_ type: Value.Type, from value: String) throws -> Value {
        try JSONDecoder().decode(type, from: Data(value.utf8))
    }
}
