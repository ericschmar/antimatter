import AntimatterFoundation
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
