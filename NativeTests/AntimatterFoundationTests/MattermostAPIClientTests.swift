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

    func testStatusIDsDecodesMattermostStatusList() async throws {
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/v4/users/status/ids")
            return (
                try Self.response(for: request, status: 200),
                Data("[{\"user_id\":\"user-1\",\"status\":\"away\"}]".utf8)
            )
        }
        let client = MattermostAPIClient(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token",
            session: stubbedSession()
        )

        let statuses: [MattermostUserStatus] = try await client.post(
            "/api/v4/users/status/ids",
            body: ["user-1"]
        )

        XCTAssertEqual(statuses.first?.userID, "user-1")
        XCTAssertEqual(statuses.first?.status, "away")
    }

    func testCreateDirectChannelUsesMattermostDirectChannelEndpoint() async throws {
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/v4/channels/direct")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            return (
                try Self.response(for: request, status: 201),
                Data("""
                {
                  "id": "channel-1",
                  "name": "user-1_user-2",
                  "display_name": "",
                  "type": "D"
                }
                """.utf8)
            )
        }

        let client = MattermostAPIClient(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token",
            session: stubbedSession()
        )
        let loader = MattermostNavigationLoader(client: client)
        let channel = try await loader.createDirectChannel(userIDs: ["user-1", "user-2"])

        XCTAssertEqual(channel.id, "channel-1")
        XCTAssertEqual(channel.type, "D")
    }

    func testViewChannelUsesMattermostChannelViewEndpoint() async throws {
        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/v4/channels/channel-2/view")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            return (try Self.response(for: request, status: 200), Data("{}".utf8))
        }
        let client = MattermostAPIClient(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token",
            session: stubbedSession()
        )
        let loader = MattermostNavigationLoader(client: client)

        try await loader.viewChannel(channelID: "channel-2", previousChannelID: "channel-1")
    }

    func testWebSocketEndpointUsesSecureScheme() throws {
        let serverURL = try XCTUnwrap(URL(string: "https://chat.example.com"))

        XCTAssertEqual(
            MattermostWebSocket.endpoint(for: serverURL).absoluteString,
            "wss://chat.example.com/api/v4/websocket"
        )
        XCTAssertEqual(
            MattermostWebSocket.upgradeRequest(for: serverURL, token: "private-token")
                .value(forHTTPHeaderField: "Authorization"),
            "Bearer private-token"
        )
    }

    func testWebSocketProtocolPayloadUsesTextFrame() {
        let message = MattermostWebSocket.textMessage(for: Data("{\"action\":\"ping\"}".utf8))

        guard case let .string(payload) = message else {
            return XCTFail("Expected a text WebSocket frame.")
        }
        XCTAssertEqual(payload, "{\"action\":\"ping\"}")
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

    func testWebSocketTypingEventDecodesChannelAndUser() throws {
        let data = Data(
            """
            {
              "event": "typing",
              "data": {
                "channel_id": "channel-1",
                "user_id": "user-1"
              },
              "seq": 2
            }
            """.utf8
        )

        let event = try JSONDecoder().decode(MattermostWebSocketEvent.self, from: data)

        XCTAssertEqual(event.event, "typing")
        XCTAssertEqual(event.data?["channel_id"]?.stringValue, "channel-1")
        XCTAssertEqual(event.data?["user_id"]?.stringValue, "user-1")
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

    func testPollsUseMatterpollCommandAndMattermostPostActions() async throws {
        var requests: [URLRequest] = []
        URLProtocolStub.handler = { request in
            requests.append(request)
            if request.httpMethod == "GET" {
                return (
                    try Self.response(for: request, status: 200),
                    Data(#"{"id":"post-1","channel_id":"channel-1","user_id":"user-1"}"#.utf8)
                )
            }
            return (try Self.response(for: request, status: 200), Data("{}".utf8))
        }
        let client = MattermostAPIClient(
            serverURL: try XCTUnwrap(URL(string: "https://chat.example.com")),
            token: "private-token",
            session: stubbedSession()
        )
        let polls = MattermostPolls(client: client)

        try await polls.create(channelID: "channel-1", teamID: "team-1", question: "Ship it?", options: ["Yes", "No"])
        let post = try await polls.vote(postID: "post-1", actionID: "vote0")

        XCTAssertEqual(requests.map { $0.url?.path }, [
            "/api/v4/commands/execute",
            "/api/v4/posts/post-1/actions/vote0",
            "/api/v4/posts/post-1",
        ])
        XCTAssertEqual(post.id, "post-1")
        XCTAssertEqual(requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer private-token")
    }

    func testPostDecodesMatterpollOptionsAndVoteCounts() throws {
        let post = try JSONDecoder().decode(MattermostPost.self, from: Data("""
        {
          "id":"post-1", "channel_id":"channel-1", "user_id":"user-1",
          "type":"custom_matterpoll", "create_at":1, "update_at":1,
          "props":{"poll_id":"poll-1","attachments":[{"title":"Ship it?","actions":[
            {"id":"vote0","name":"Yes (12)","type":"button"},
            {"id":"addOption","name":"Add Option","type":"button"}
          ]}]}
        }
        """.utf8))

        let option = try XCTUnwrap(post.poll?.attachment?.actions.first)
        XCTAssertEqual(post.poll?.pollID, "poll-1")
        XCTAssertEqual(option.option, "Yes")
        XCTAssertEqual(option.voteCount, 12)
        XCTAssertTrue(option.isVote)
        XCTAssertFalse(post.poll?.attachment?.actions[1].isVote ?? true)
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
