import Foundation
import XCTest

@testable import AntimatterApp

@MainActor
final class DirectMessageWindowTests: XCTestCase {
    func testRegistryUsesServerAndChannelInsteadOfTitle() throws {
        let firstRoute = try route(title: "Ada")
        let renamedRoute = try route(title: "Ada Lovelace")
        let registry = DirectMessageWindowRegistry()

        XCTAssertEqual(firstRoute, renamedRoute)
        XCTAssertTrue(registry.claim(firstRoute))
        XCTAssertFalse(registry.claim(renamedRoute))

        registry.release(firstRoute)
        XCTAssertTrue(registry.claim(renamedRoute))
    }

    private func route(title: String) throws -> DirectMessageWindowRoute {
        try JSONDecoder().decode(
            DirectMessageWindowRoute.self,
            from: Data("""
            {"serverURL":"https://chat.example.com","channelID":"dm-1","title":"\(title)"}
            """.utf8)
        )
    }
}
