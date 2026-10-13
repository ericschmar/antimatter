import XCTest

@testable import AntimatterApp

final class TimelineMessageSpacingTests: XCTestCase {
    func testMessageSpacingDefaultsToMediumAndMapsAllOptions() {
        XCTAssertEqual(TimelineMessageSpacing(storedValue: nil), .medium)
        XCTAssertEqual(TimelineMessageSpacing.small.verticalPadding, 1)
        XCTAssertEqual(TimelineMessageSpacing.medium.verticalPadding, 3)
        XCTAssertEqual(TimelineMessageSpacing.large.verticalPadding, 6)
    }

    func testMessageSpacingPersistsItsSelectedOption() {
        let suiteName = "TimelineMessageSpacingTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        defaults.set(TimelineMessageSpacing.large.rawValue, forKey: TimelineMessageSpacing.storageKey)

        XCTAssertEqual(
            TimelineMessageSpacing(storedValue: defaults.string(forKey: TimelineMessageSpacing.storageKey)),
            .large
        )
    }
}
