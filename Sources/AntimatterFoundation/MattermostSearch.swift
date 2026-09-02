import Foundation

public struct MattermostPostSearchRequest: Encodable, Sendable {
    public let terms: String
    public let isOrSearch: Bool

    public init(terms: String, isOrSearch: Bool = false) {
        self.terms = terms
        self.isOrSearch = isOrSearch
    }

    enum CodingKeys: String, CodingKey {
        case terms
        case isOrSearch = "is_or_search"
    }
}

public actor MattermostSearchLoader {
    private let client: MattermostAPIClient

    public init(client: MattermostAPIClient) {
        self.client = client
    }

    public func searchPosts(terms: String) async throws -> [MattermostPost] {
        let response: MattermostPostList = try await client.post(
            "/api/v4/posts/search",
            body: MattermostPostSearchRequest(terms: terms)
        )
        return response.orderedPosts
    }
}
