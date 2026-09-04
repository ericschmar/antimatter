@testable import AntimatterFoundation
import Foundation
import XCTest

final class GiphyClientTests: XCTestCase {
    override func tearDown() {
        GiphyURLProtocolStub.handler = nil
        super.tearDown()
    }

    func testSearchUsesSafeRatingAndReturnsPreviewAndOriginalURLs() async throws {
        GiphyURLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.path, "/v1/gifs/search")
            let queryItems = URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?
                .queryItems
            XCTAssertEqual(queryItems?.first(where: { $0.name == "api_key" })?.value, "public-key")
            XCTAssertEqual(queryItems?.first(where: { $0.name == "q" })?.value, "office dogs")
            XCTAssertEqual(queryItems?.first(where: { $0.name == "rating" })?.value, "pg-13")
            XCTAssertEqual(queryItems?.first(where: { $0.name == "limit" })?.value, "10")

            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            ))
            let payload = """
            {"data":[{"id":"gif-1","title":"Office dog","images":{
                "fixed_width":{"url":"https://media.example.com/preview.gif"},
                "original":{"url":"https://media.example.com/original.gif"}
            }}]}
            """
            return (response, Data(payload.utf8))
        }
        let client = GiphyClient(apiKey: "public-key", session: stubbedSession())

        let gifs = try await client.search("office dogs", limit: 10)

        XCTAssertEqual(
            gifs,
            [GiphyGIF(
                id: "gif-1",
                title: "Office dog",
                previewURL: try XCTUnwrap(URL(string: "https://media.example.com/preview.gif")),
                mediaURL: try XCTUnwrap(URL(string: "https://media.example.com/original.gif"))
            )]
        )
    }

    private func stubbedSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GiphyURLProtocolStub.self]
        return URLSession(configuration: configuration)
    }
}

private final class GiphyURLProtocolStub: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let (response, data) = try Self.handler?(request) ?? {
                throw URLError(.badServerResponse)
            }()
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
