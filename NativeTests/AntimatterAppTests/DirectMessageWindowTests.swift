import AntimatterFoundation
import Foundation
import XCTest

@testable import AntimatterApp

@MainActor
final class DirectMessageWindowTests: XCTestCase {
    override func tearDown() {
        DirectMessageURLProtocolStub.handler = nil
        super.tearDown()
    }

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

    func testNewDirectMessageForWindowDoesNotSelectWorkspace() async throws {
        let serverURL = try XCTUnwrap(URL(string: "https://chat.example.com"))
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let defaultsName = "DirectMessageWindowTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: defaultsName))
        defer {
            try? FileManager.default.removeItem(at: directory)
            defaults.removePersistentDomain(forName: defaultsName)
        }
        DirectMessageURLProtocolStub.handler = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/v4/users/me/teams"):
                return Self.response(for: request, body: "[]")
            case ("GET", "/api/v4/users/me/channels"):
                return Self.response(for: request, body: #"[{"id":"channel-current","name":"general","display_name":"General","type":"O"}]"#)
            case ("GET", "/api/v4/users/me"):
                return Self.response(for: request, body: #"{"id":"current-user","username":"current"}"#)
            case ("GET", "/api/v4/users/me/channels/channel-current/unread"):
                return Self.response(for: request, body: #"{"channel_id":"channel-current","msg_count":0,"mention_count":0}"#)
            case ("POST", "/api/v4/channels/direct"):
                return Self.response(for: request, status: 201, body: #"{"id":"channel-direct","name":"current-user_recipient-user","display_name":"","type":"D"}"#)
            case ("GET", "/api/v4/users/recipient-user/image"):
                return Self.response(for: request, body: "avatar")
            default:
                throw MattermostAPIError.invalidResponse
            }
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DirectMessageURLProtocolStub.self]
        let client = MattermostAPIClient(
            serverURL: serverURL,
            token: "test-token",
            session: URLSession(configuration: configuration)
        )
        let navigation = NavigationViewModel(
            loader: MattermostNavigationLoader(client: client),
            store: MattermostLocalStore(serverURL: serverURL, directory: directory),
            defaults: defaults
        )
        await navigation.load()

        let presentation = DirectMessagePresentation(automaticallyOpenInNewWindow: true)
        let channel = await navigation.openDirectMessage(
            with: MattermostUser(id: "recipient-user", username: "recipient", displayName: "Recipient"),
            selectInWorkspace: presentation.selectsInWorkspace
        )

        XCTAssertEqual(presentation, .window)
        XCTAssertFalse(presentation.selectsInWorkspace)
        XCTAssertEqual(channel?.id, "channel-direct")
        XCTAssertEqual(navigation.selectedChannelID, "channel-current")
        XCTAssertTrue(navigation.channels.contains { $0.id == "channel-direct" })
    }

    private static func response(for request: URLRequest, status: Int = 200, body: String) -> (HTTPURLResponse, Data) {
        (HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, Data(body.utf8))
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

private final class DirectMessageURLProtocolStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let response = try Self.handler?(request) ?? (try response(for: request), Data())
            client?.urlProtocol(self, didReceive: response.0, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: response.1)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private func response(for request: URLRequest) throws -> HTTPURLResponse {
        try XCTUnwrap(HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 500, httpVersion: nil, headerFields: nil))
    }
}
