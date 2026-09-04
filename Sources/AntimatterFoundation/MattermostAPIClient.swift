import Foundation

public struct MattermostPage: Equatable, Sendable {
    public let index: Int
    public let size: Int

    public init(index: Int = 0, size: Int = 60) {
        self.index = max(0, index)
        self.size = min(max(1, size), 200)
    }

    var queryItems: [URLQueryItem] {
        [
            URLQueryItem(name: "page", value: String(index)),
            URLQueryItem(name: "per_page", value: String(size)),
        ]
    }
}

public enum MattermostAPIError: Error, Equatable, LocalizedError, Sendable {
    case invalidResponse
    case rejected(status: Int, message: String?)
    case decoding

    public var errorDescription: String? {
        switch self {
        case .invalidResponse: "The server returned an invalid response."
        case let .rejected(status, message): message ?? "Request failed (HTTP \(status))."
        case .decoding: "The server returned data in an unexpected format."
        }
    }
}

public actor MattermostAPIClient {
    private let serverURL: URL
    private let token: String
    private let session: URLSession
    private var cachedResponses: [URL: CachedResponse] = [:]
    private let maximumCachedResponses = 20
    private let maximumCachedResponseSize = 1_024 * 1_024

    /// Uses a private, memory-only response cache so authenticated responses are never
    /// shared between accounts or persisted to disk. Cache freshness remains server-controlled.
    public init(serverURL: URL, token: String, session: URLSession? = nil) {
        self.serverURL = serverURL
        self.token = token
        self.session = session ?? Self.cachingSession()
    }

    public func get<Response: Decodable & Sendable>(
        _ path: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> Response {
        try await request(path, method: "GET", queryItems: queryItems, body: Optional<Data>.none)
    }

    public func getPage<Response: Decodable & Sendable>(
        _ path: String,
        page: MattermostPage
    ) async throws -> Response {
        try await get(path, queryItems: page.queryItems)
    }

    /// Fetches a non-JSON resource using the same authenticated session as the API.
    public func getData(_ path: String) async throws -> Data {
        var request = URLRequest(url: URL(string: path, relativeTo: serverURL)!.absoluteURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("image/*", forHTTPHeaderField: "Accept")

        if let cached = cachedData(for: request.url!) {
            return cached
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw MattermostAPIError.invalidResponse
        }
        guard (200 ..< 300).contains(response.statusCode) else {
            throw MattermostAPIError.rejected(status: response.statusCode, message: nil)
        }
        cache(data, for: request.url!, response: response)
        return data
    }

    public func post<Body: Encodable & Sendable, Response: Decodable & Sendable>(
        _ path: String,
        body: Body
    ) async throws -> Response {
        try await request(path, method: "POST", queryItems: [], body: try JSONEncoder().encode(body))
    }

    /// Posts a multipart form while retaining the client's authenticated, memory-only session.
    public func postMultipart<Response: Decodable & Sendable>(
        _ path: String,
        body: Data,
        boundary: String
    ) async throws -> Response {
        var request = URLRequest(url: URL(string: path, relativeTo: serverURL)!.absoluteURL)
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        cachedResponses.removeAll()
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw MattermostAPIError.invalidResponse
        }
        guard (200 ..< 300).contains(response.statusCode) else {
            throw MattermostAPIError.rejected(
                status: response.statusCode,
                message: try? JSONDecoder().decode(ServerError.self, from: data).message
            )
        }
        return try decode(Response.self, from: data)
    }

    public func delete<Response: Decodable & Sendable>(_ path: String) async throws -> Response {
        try await request(path, method: "DELETE", queryItems: [], body: Optional<Data>.none)
    }

    public func put<Body: Encodable & Sendable, Response: Decodable & Sendable>(
        _ path: String,
        body: Body
    ) async throws -> Response {
        try await request(path, method: "PUT", queryItems: [], body: try JSONEncoder().encode(body))
    }

    private func request<Response: Decodable & Sendable>(
        _ path: String,
        method: String,
        queryItems: [URLQueryItem],
        body: Data?
    ) async throws -> Response {
        var components = URLComponents(url: URL(string: path, relativeTo: serverURL)!.absoluteURL, resolvingAgainstBaseURL: false)!
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }

        if method == "GET", let cached = cachedData(for: request.url!) {
            return try decode(Response.self, from: cached)
        }
        if method != "GET" {
            cachedResponses.removeAll()
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw MattermostAPIError.invalidResponse
        }
        guard (200 ..< 300).contains(response.statusCode) else {
            throw MattermostAPIError.rejected(
                status: response.statusCode,
                message: try? JSONDecoder().decode(ServerError.self, from: data).message
            )
        }
        if method == "GET" {
            cache(data, for: request.url!, response: response)
        }
        return try decode(Response.self, from: data)
    }

    static func cachingSession(configuration: URLSessionConfiguration = .ephemeral) -> URLSession {
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }

    private func cachedData(for url: URL) -> Data? {
        guard let cached = cachedResponses[url] else { return nil }
        guard cached.expiresAt > Date() else {
            cachedResponses.removeValue(forKey: url)
            return nil
        }
        return cached.data
    }

    private func cache(_ data: Data, for url: URL, response: HTTPURLResponse) {
        guard data.count <= maximumCachedResponseSize,
              let maxAge = maxAge(from: response),
              maxAge > 0
        else { return }
        if cachedResponses[url] == nil, cachedResponses.count >= maximumCachedResponses,
           let oldestURL = cachedResponses.min(by: { $0.value.expiresAt < $1.value.expiresAt })?.key {
            cachedResponses.removeValue(forKey: oldestURL)
        }
        cachedResponses[url] = CachedResponse(
            data: data,
            expiresAt: Date().addingTimeInterval(TimeInterval(maxAge))
        )
    }

    private func maxAge(from response: HTTPURLResponse) -> Int? {
        let directives = response.value(forHTTPHeaderField: "Cache-Control")?
            .lowercased()
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) } ?? []
        guard !directives.contains("no-cache"), !directives.contains("no-store") else { return nil }
        return directives
            .first(where: { $0.hasPrefix("max-age=") })
            .flatMap { Int($0.dropFirst("max-age=".count).trimmingCharacters(in: CharacterSet(charactersIn: "\""))) }
    }

    private func decode<Response: Decodable & Sendable>(
        _ type: Response.Type,
        from data: Data
    ) throws -> Response {
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw MattermostAPIError.decoding
        }
    }
}

private struct CachedResponse {
    let data: Data
    let expiresAt: Date
}

private struct ServerError: Decodable {
    let message: String?
}
