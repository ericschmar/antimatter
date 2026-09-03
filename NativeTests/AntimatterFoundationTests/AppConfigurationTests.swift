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

    func testSessionStoreRestoresSavedSession() throws {
        let defaults = makeDefaults()
        let store = MattermostSessionStore(secrets: InMemorySecureValueStore(), defaults: defaults)
        let session = MattermostSession(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token"
        )

        try store.save(session)

        XCTAssertEqual(try store.restore(), session)
    }

    func testSessionStoreRemovalClearsSavedSession() throws {
        let defaults = makeDefaults()
        let store = MattermostSessionStore(secrets: InMemorySecureValueStore(), defaults: defaults)
        let session = MattermostSession(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token"
        )
        try store.save(session)

        try store.remove()

        XCTAssertNil(try store.restore())
    }

    func testSessionStoreRestoresConfiguredServerInsteadOfLastServer() throws {
        let defaults = makeDefaults()
        let secrets = InMemorySecureValueStore()
        let store = MattermostSessionStore(secrets: secrets, defaults: defaults)
        let lastSession = MattermostSession(
            serverURL: try XCTUnwrap(URL(string: "https://last.example.com")),
            token: "last-token"
        )
        let configuredSession = MattermostSession(
            serverURL: try XCTUnwrap(URL(string: "https://configured.example.com")),
            token: "configured-token"
        )
        try store.save(lastSession)
        try secrets.save(
            Data(configuredSession.token.utf8),
            account: configuredSession.serverURL.absoluteString,
            service: MattermostSessionStore.keychainService
        )

        XCTAssertEqual(try store.restore(serverURL: configuredSession.serverURL), configuredSession)
    }

    private func makeDefaults() -> UserDefaults {
        let suiteName = "MattermostSessionStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }
}

private final class InMemorySecureValueStore: SecureValueStore, @unchecked Sendable {
    private var values: [String: Data] = [:]

    func save(_ value: Data, account: String, service: String) throws {
        values[key(account: account, service: service)] = value
    }

    func value(account: String, service: String) throws -> Data? {
        values[key(account: account, service: service)]
    }

    func removeValue(account: String, service: String) throws {
        values.removeValue(forKey: key(account: account, service: service))
    }

    private func key(account: String, service: String) -> String {
        "\(service):\(account)"
    }
}
