import XCTest

@testable import AntimatterApp

@MainActor
final class SettingsWindowTests: XCTestCase {
    func testSettingsRouteRequestsStableSettingsScene() {
        var requestedIDs: [String] = []

        requestSettingsWindow { requestedIDs.append($0) }

        XCTAssertEqual(SettingsWindow.sceneID, "settings")
        XCTAssertEqual(requestedIDs, ["settings"])
    }
}
