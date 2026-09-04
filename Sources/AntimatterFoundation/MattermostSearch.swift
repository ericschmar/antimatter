import Foundation

public struct MattermostPostSearchFilters: Equatable, Sendable {
    public enum ThreadScope: String, CaseIterable, Identifiable, Sendable {
        case all
        case roots
        case replies

        public var id: String { rawValue }
    }

    public var channel: String?
    public var sender: String?
    public var after: Date?
    public var before: Date?
    public var hasFiles = false
    public var fileExtension = ""
    public var threadScope = ThreadScope.all
    public var pinnedOnly = false
    public var savedOnly = false

    public init() {}

    public var hasActiveFilters: Bool {
        channel != nil || sender != nil || after != nil || before != nil || hasFiles ||
            !fileExtension.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            threadScope != .all || pinnedOnly || savedOnly
    }

    /// Mattermost post search accepts its structured filters as search modifiers.
    public func applying(to query: String) -> String {
        var terms = [query.trimmingCharacters(in: .whitespacesAndNewlines)]
        if let channel, !channel.isEmpty { terms.append("in:\(channel)") }
        if let sender, !sender.isEmpty { terms.append("from:\(sender)") }
        if let after { terms.append("after:\(Self.searchDate(after))") }
        if let before { terms.append("before:\(Self.searchDate(before))") }
        if hasFiles { terms.append("has:files") }

        let fileExtension = fileExtension.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        if !fileExtension.isEmpty { terms.append("ext:\(fileExtension)") }

        switch threadScope {
        case .all: break
        case .roots: terms.append("-is:reply")
        case .replies: terms.append("is:reply")
        }
        if pinnedOnly { terms.append("is:pinned") }
        if savedOnly { terms.append("is:saved") }
        return terms.filter { !$0.isEmpty }.joined(separator: " ")
    }

    private static func searchDate(_ date: Date) -> String {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
    }
}

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

    public func searchPosts(
        terms: String,
        filters: MattermostPostSearchFilters = .init()
    ) async throws -> [MattermostPost] {
        let response: MattermostPostList = try await client.post(
            "/api/v4/posts/search",
            body: MattermostPostSearchRequest(terms: filters.applying(to: terms))
        )
        return response.orderedPosts
    }
}
