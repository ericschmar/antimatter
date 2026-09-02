import AntimatterFoundation
import XCTest

final class AppConfigurationTests: XCTestCase {
    func testLoadUsesProductionAndNoServerByDefault() throws {
        let configuration = try AppConfiguration.load(environment: [:])

        XCTAssertEqual(configuration.environment, .production)
        XCTAssertNil(configuration.initialServerURL)
    }

    func testLoadReadsDevelopmentServerURL() throws {
        let configuration = try AppConfiguration.load(environment: [
            "ANTIMATTER_ENV": "development",
            "ANTIMATTER_SERVER_URL": "https://chat.example.com",
        ])

        XCTAssertEqual(configuration.environment, .development)
        XCTAssertEqual(configuration.initialServerURL, URL(string: "https://chat.example.com"))
    }

    func testLoadRejectsUnsupportedServerURL() {
        XCTAssertThrowsError(
            try AppConfiguration.load(environment: ["ANTIMATTER_SERVER_URL": "file:///tmp/chat"])
        ) { error in
            XCTAssertEqual(
                error as? AppConfiguration.ConfigurationError,
                .invalidServerURL("file:///tmp/chat")
            )
        }
    }

    func testLoadRejectsServerURLWithCredentials() {
        XCTAssertThrowsError(
            try AppConfiguration.load(environment: [
                "ANTIMATTER_SERVER_URL": "https://access-token@chat.example.com",
            ])
        ) { error in
            XCTAssertEqual(
                error as? AppConfiguration.ConfigurationError,
                .invalidServerURL("https://access-token@chat.example.com")
            )
        }
    }
}
