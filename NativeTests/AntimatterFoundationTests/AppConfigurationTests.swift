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

    func testSAMLURLContainsOnlyTheDesktopClientToken() async throws {
        let authenticator = MattermostAuthenticator()
        let serverURL = try XCTUnwrap(URL(string: "https://chat.example.com"))

        let loginURL = await authenticator.samlLoginURL(
            serverURL: serverURL,
            clientToken: "desktop-client-token"
        )

        XCTAssertEqual(loginURL.absoluteString, "https://chat.example.com/login/sso/saml?desktop_token=desktop-client-token")
    }

    func testCompleteSAMLSignInRejectsCallbackForAnotherClient() async throws {
        let authenticator = MattermostAuthenticator()
        let serverURL = try XCTUnwrap(URL(string: "https://chat.example.com"))
        let callbackURL = try XCTUnwrap(
            URL(string: "mattermost-dev://login?client_token=another-client&server_token=server-token")
        )

        do {
            _ = try await authenticator.completeSAMLSignIn(
                serverURL: serverURL,
                callbackURL: callbackURL,
                expectedClientToken: "desktop-client-token"
            )
            XCTFail("Expected a callback validation error.")
        } catch let error as MattermostAuthenticationError {
            XCTAssertEqual(error, .invalidSSOCallback)
        }
    }
}
