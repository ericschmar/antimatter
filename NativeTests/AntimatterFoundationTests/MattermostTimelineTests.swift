import AntimatterFoundation
import XCTest

final class MattermostTimelineTests: XCTestCase {
    func testUserDecodingUsesPersonNameBeforeUsername() throws {
        let user = try JSONDecoder().decode(
            MattermostUser.self,
            from: Data("{\"id\":\"user-1\",\"username\":\"ada\",\"first_name\":\"Ada\",\"last_name\":\"Lovelace\"}".utf8)
        )

        XCTAssertEqual(user.displayName, "Ada Lovelace")
        XCTAssertEqual(user.username, "ada")
    }

    func testPostListPreservesServerOrderAndIncludesUnorderedPosts() {
        let early = post(id: "early", createdAt: 1)
        let latest = post(id: "latest", createdAt: 2)
        let response = MattermostPostList(
            order: ["latest"],
            posts: [early.id: early, latest.id: latest]
        )

        XCTAssertEqual(response.orderedPosts.first?.id, "latest")
        XCTAssertEqual(Set(response.orderedPosts.map(\.id)), Set(["early", "latest"]))
    }

    private func post(id: String, createdAt: Int64) -> MattermostPost {
        MattermostPost(
            id: id,
            channelID: "channel",
            userID: "user",
            message: "Message",
            createAt: createdAt,
            updateAt: createdAt
        )
    }
}
