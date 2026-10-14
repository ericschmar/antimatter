import XCTest

@testable import AntimatterApp

final class LatestOnlyUpdateQueueTests: XCTestCase {
    func testDiscardsAnInFlightObsoleteResultAndAppliesTheLatestQueuedUpdate() async {
        let gate = TransformGate()
        let queue = LatestOnlyUpdateQueue<Int, Int> { value in
            if value == 1 {
                await gate.markFirstTransformStarted()
                await gate.waitForFirstTransformRelease()
            }
            return value
        }

        let obsolete = Task { await queue.submit(1) }
        await gate.waitForFirstTransformStart()

        let latest = Task { await queue.submit(2) }
        await Task.yield()
        await gate.releaseFirstTransform()

        let obsoleteResult = await obsolete.value
        let latestResult = await latest.value
        XCTAssertNil(obsoleteResult)
        XCTAssertEqual(latestResult, 2)
    }
}

private actor TransformGate {
    private var firstTransformHasStarted = false
    private var firstTransformHasReleased = false
    private var startContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?

    func markFirstTransformStarted() {
        firstTransformHasStarted = true
        startContinuation?.resume()
        startContinuation = nil
    }

    func waitForFirstTransformStart() async {
        guard !firstTransformHasStarted else { return }
        await withCheckedContinuation { startContinuation = $0 }
    }

    func waitForFirstTransformRelease() async {
        guard !firstTransformHasReleased else { return }
        await withCheckedContinuation { releaseContinuation = $0 }
    }

    func releaseFirstTransform() {
        firstTransformHasReleased = true
        releaseContinuation?.resume()
        releaseContinuation = nil
    }
}
