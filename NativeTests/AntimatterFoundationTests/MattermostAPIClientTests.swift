@testable import AntimatterFoundation
import Foundation
import XCTest

final class MattermostAPIClientTests: XCTestCase {
    override func tearDown() {
        URLProtocolStub.handler = nil
        super.tearDown()
    }

    func testGetPageSendsAuthorizationAndPagination() async throws {
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer private-token")
            XCTAssertEqual(request.url?.path, "/api/v4/teams")
            XCTAssertEqual(request.url?.query, "page=2&per_page=60")
            return (try Self.response(for: request, status: 200), Data("[{\"id\":\"team-1\"}]".utf8))
        }

        let client = MattermostAPIClient(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token",
            session: stubbedSession()
        )
        let teams: [Team] = try await client.getPage("/api/v4/teams", page: MattermostPage(index: 2))

        XCTAssertEqual(teams, [Team(id: "team-1")])
    }

    func testGetSurfacesServerErrorMessage() async throws {
        URLProtocolStub.handler = { request in
            (try Self.response(for: request, status: 401), Data("{\"message\":\"Invalid token\"}".utf8))
        }

        let client = MattermostAPIClient(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token",
            session: stubbedSession()
        )

        do {
            let _: Team = try await client.get("/api/v4/users/me")
            XCTFail("Expected an API error.")
        } catch let error as MattermostAPIError {
            XCTAssertEqual(error, .rejected(status: 401, message: "Invalid token"))
        }
    }

    func testWebSocketEndpointUsesSecureScheme() throws {
        let serverURL = try XCTUnwrap(URL(string: "https://chat.example.com"))

        XCTAssertEqual(
            MattermostWebSocket.endpoint(for: serverURL).absoluteString,
            "wss://chat.example.com/api/v4/websocket"
        )
        XCTAssertNil(MattermostWebSocket.upgradeRequest(for: serverURL).value(forHTTPHeaderField: "Authorization"))
    }

    func testWebSocketReconnectDelayUsesBoundedExponentialBackoff() {
        XCTAssertEqual(MattermostWebSocket.reconnectDelay(for: 0), .seconds(1))
        XCTAssertEqual(MattermostWebSocket.reconnectDelay(for: 1), .seconds(2))
        XCTAssertEqual(MattermostWebSocket.reconnectDelay(for: 5), .seconds(30))
        XCTAssertEqual(MattermostWebSocket.reconnectDelay(for: 10), .seconds(30))
    }

    func testWebSocketEventDecodesNestedPostAndUnreadCounts() throws {
        let data = Data(
            """
            {
              "event": "posted",
              "data": {
                "post": "{\\"id\\":\\"post-1\\",\\"channel_id\\":\\"channel-1\\",\\"user_id\\":\\"user-1\\",\\"message\\":\\"A message\\",\\"create_at\\":1,\\"update_at\\":1}",
                "msg_count": 3,
                "mention_count": "2"
              },
              "seq": 1
            }
            """.utf8
        )
        let event = try JSONDecoder().decode(MattermostWebSocketEvent.self, from: data)

        XCTAssertEqual(event.decodedData(MattermostPost.self, forKey: "post")?.id, "post-1")
        XCTAssertEqual(event.data?["msg_count"]?.intValue, 3)
        XCTAssertEqual(event.data?["mention_count"]?.intValue, 2)
    }

    func testReactionEndpointsUseAuthenticatedMattermostPaths() async throws {
        var requestedPaths: [String] = []
        URLProtocolStub.handler = { request in
            requestedPaths.append(request.url!.path)
            if request.httpMethod == "POST" {
                return (
                    try Self.response(for: request, status: 201),
                    Data("{\"user_id\":\"user-1\",\"post_id\":\"post-1\",\"emoji_name\":\"heart\"}".utf8)
                )
            }
            return (try Self.response(for: request, status: 200), Data("{}".utf8))
        }
        let client = MattermostAPIClient(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token",
            session: stubbedSession()
        )
        let reactions = MattermostReactions(client: client)

        try await reactions.add(postID: "post-1", emojiName: "heart", userID: "user-1")
        try await reactions.remove(postID: "post-1", emojiName: "heart", userID: "user-1")

        XCTAssertEqual(requestedPaths, [
            "/api/v4/reactions",
            "/api/v4/users/user-1/posts/post-1/reactions/heart",
        ])
    }

    func testTimelineIdentityRequestsAreAuthenticated() async throws {
        var requestedPaths: [String] = []
        URLProtocolStub.handler = { request in
            requestedPaths.append(request.url!.path)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer private-token")
            if request.httpMethod == "POST" {
                return (try Self.response(for: request, status: 200), Data("[{\"id\":\"user-1\",\"username\":\"ada\"}]".utf8))
            }
            return (try Self.response(for: request, status: 200), Data([0x89, 0x50, 0x4E, 0x47]))
        }
        let client = MattermostAPIClient(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token",
            session: stubbedSession()
        )
        let loader = MattermostTimelineLoader(client: client)

        let users = try await loader.loadUsers(ids: ["user-1"])
        _ = try await loader.loadAvatarData(userID: "user-1")

        XCTAssertEqual(users.first?.displayName, "ada")
        XCTAssertEqual(requestedPaths, ["/api/v4/users/ids", "/api/v4/users/user-1/image"])
    }

    private func stubbedSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return URLSession(configuration: configuration)
    }

    private static func response(for request: URLRequest, status: Int) throws -> HTTPURLResponse {
        try XCTUnwrap(HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: status, httpVersion: nil, headerFields: nil))
    }
}

private struct Team: Codable, Equatable, Sendable {
    let id: String
}

private final class URLProtocolStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let response = try Self.handler?(request) ?? (try Self.response(for: request), Data())
            client?.urlProtocol(self, didReceive: response.0, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: response.1)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func response(for request: URLRequest) throws -> HTTPURLResponse {
        try XCTUnwrap(HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: 500, httpVersion: nil, headerFields: nil))
    }
}
