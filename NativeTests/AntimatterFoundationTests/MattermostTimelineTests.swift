import AntimatterFoundation
import XCTest

final class MattermostTimelineTests: XCTestCase {
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
