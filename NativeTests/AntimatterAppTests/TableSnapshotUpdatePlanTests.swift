import XCTest
import AppKit
import SwiftUI

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

    func testHeightInvalidationUsesCurrentIndexesForStableRowIDs() {
        XCTAssertEqual(
            TimelineRowHeightInvalidationPlan.indexes(
                rowIDs: ["day-1", "message-2", "message-3"],
                invalidatedRowIDs: ["message-2", "removed-message"]
            ),
            IndexSet(integer: 1)
        )
    }

    @MainActor
    func testIntrinsicOnlyHostedTextRemainsSingleLineWhenConstrained() {
        let message = String(repeating: "A long message that must wrap within the timeline column. ", count: 8)
        let host = NSHostingView(rootView: AnyView(Text(message).frame(maxWidth: .infinity, alignment: .leading)))
        host.sizingOptions = [.intrinsicContentSize]

        let container = NSView()
        container.addSubview(host)
        host.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            host.topAnchor.constraint(equalTo: container.topAnchor),
        ])
        container.frame.size.width = 200
        container.layoutSubtreeIfNeeded()

        XCTAssertEqual(host.fittingSize.height, host.intrinsicContentSize.height)
    }

    @MainActor
    func testHostingViewMeasuresWrappedTextAtTheColumnWidth() {
        let message = String(repeating: "A long message that must wrap within the timeline column. ", count: 8)
        let host = NSHostingController(rootView: AnyView(Text(message).frame(maxWidth: .infinity, alignment: .leading)))

        let wrappedHeight = host.sizeThatFits(
            in: CGSize(width: 200, height: TimelineRowHeightPlan.maximumMeasurementHeight)
        ).height

        XCTAssertGreaterThan(wrappedHeight, host.view.intrinsicContentSize.height)
    }

    @MainActor
    func testVerticallyFixedHostingRootDoesNotExpandToTheMeasurementProposal() {
        let root = AnyView(
            VStack(alignment: .leading) {
                Text("Message content")
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        )
        let flexibleHost = NSHostingController(rootView: root)
        let fixedHost = NSHostingController(rootView: AnyView(root.fixedSize(horizontal: false, vertical: true)))
        let proposal = CGSize(width: 200, height: TimelineRowHeightPlan.maximumMeasurementHeight)

        XCTAssertEqual(flexibleHost.sizeThatFits(in: proposal).height, TimelineRowHeightPlan.maximumMeasurementHeight)
        XCTAssertLessThan(fixedHost.sizeThatFits(in: proposal).height, TimelineRowHeightPlan.maximumMeasurementHeight)
    }

    func testRowMeasurementHeightIsFinite() {
        XCTAssertTrue(TimelineRowHeightPlan.maximumMeasurementHeight.isFinite)
    }

    func testRowHeightFallsBackWhenTheMeasurementIsNotFinite() {
        XCTAssertEqual(
            TimelineRowHeightPlan.height(measuredHeight: .infinity, estimatedHeight: 44),
            44
        )
    }

    func testRowHeightFallsBackWhenTheEstimateIsNotFinite() {
        XCTAssertEqual(
            TimelineRowHeightPlan.height(measuredHeight: nil, estimatedHeight: .infinity),
            44
        )
    }

}
