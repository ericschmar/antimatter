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

    func testGroupingGroupsConsecutiveMessagesFromSameAuthorWithinInterval() {
        let grouping = MattermostTimelineGrouping(maximumInterval: 300)
        let previous = post(id: "first", userID: "ada", createdAt: 1_000)
        let next = post(id: "next", userID: "ada", createdAt: 301_000)

        XCTAssertTrue(grouping.shouldGroup(next, with: previous))
    }

    func testGroupingDoesNotGroupMessagesOutsideIntervalOrFromDifferentAuthors() {
        let grouping = MattermostTimelineGrouping(maximumInterval: 300)
        let previous = post(id: "first", userID: "ada", createdAt: 1_000)

        XCTAssertFalse(grouping.shouldGroup(post(id: "late", userID: "ada", createdAt: 301_001), with: previous))
        XCTAssertFalse(grouping.shouldGroup(post(id: "other", userID: "grace", createdAt: 2_000), with: previous))
    }

    func testGroupingCanBeDisabled() {
        let grouping = MattermostTimelineGrouping(maximumInterval: 0)
        let previous = post(id: "first", userID: "ada", createdAt: 1_000)
        let next = post(id: "next", userID: "ada", createdAt: 2_000)

        XCTAssertFalse(grouping.shouldGroup(next, with: previous))
    }

    private func post(id: String, userID: String = "user", createdAt: Int64) -> MattermostPost {
        MattermostPost(
            id: id,
            channelID: "channel",
            userID: userID,
            message: "Message",
            createAt: createdAt,
            updateAt: createdAt
        )
    }
}
