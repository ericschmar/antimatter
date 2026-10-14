import XCTest

@testable import AntimatterApp

final class TableSnapshotUpdatePlanTests: XCTestCase {
    func testPlansPrependWithoutReloadingExistingRows() {
        XCTAssertEqual(
            TableSnapshotUpdatePlan.make(
                oldIDs: ["day", "message-2", "message-3"],
                newIDs: ["day", "message-1", "message-2", "message-3"]
            ),
            .incremental(removals: [], insertions: IndexSet(integer: 1))
        )
    }

    func testPlansAppendWithoutReloadingExistingRows() {
        XCTAssertEqual(
            TableSnapshotUpdatePlan.make(
                oldIDs: ["day", "message-1"],
                newIDs: ["day", "message-1", "message-2"]
            ),
            .incremental(removals: [], insertions: IndexSet(integer: 2))
        )
    }

    func testPlansRemovalUsingOldSnapshotIndexes() {
        XCTAssertEqual(
            TableSnapshotUpdatePlan.make(
                oldIDs: ["day", "message-1", "message-2"],
                newIDs: ["day", "message-2"]
            ),
            .incremental(removals: IndexSet(integer: 1), insertions: [])
        )
    }

    func testFallsBackToReloadWhenExistingRowsReorder() {
        XCTAssertEqual(
            TableSnapshotUpdatePlan.make(
                oldIDs: ["day", "message-1", "message-2"],
                newIDs: ["day", "message-2", "message-1"]
            ),
            .reload
        )
    }

    func testFallsBackToReloadForDuplicateIDs() {
        XCTAssertEqual(
            TableSnapshotUpdatePlan.make(
                oldIDs: ["day", "message-1"],
                newIDs: ["day", "message-1", "message-1"]
            ),
            .reload
        )
    }

    func testPaginationAnchorUsesFirstVisibleMessageInsteadOfSameDayHeader() {
        XCTAssertEqual(
            TableVisibleAnchorPlan.preferredRow(
                rowIDs: ["load-earlier", "day-1", "message-2", "message-3"],
                visibleRows: 1..<4,
                retaining: ["load-earlier", "day-1", "message-1", "message-2", "message-3"]
            ),
            2
        )
    }

    func testFocusedCollapsedReplyIsMaterializedThroughItsPosition() {
        XCTAssertEqual(
            inlineReplyPrefixCount(
                replyIDs: ["reply-1", "reply-2", "reply-3", "reply-4"],
                focusedPostID: "reply-3",
                showsAllReplies: false
            ),
            3
        )
    }

    func testCollapsedRepliesStillDefaultToTwoWithoutFocus() {
        XCTAssertEqual(
            inlineReplyPrefixCount(
                replyIDs: ["reply-1", "reply-2", "reply-3"],
                focusedPostID: nil,
                showsAllReplies: false
            ),
            2
        )
    }
}
