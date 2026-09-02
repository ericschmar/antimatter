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

    public init(serverURL: URL, token: String, session: URLSession = .shared) {
        self.serverURL = serverURL
        self.token = token
        self.session = session
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

    public func post<Body: Encodable & Sendable, Response: Decodable & Sendable>(
        _ path: String,
        body: Body
    ) async throws -> Response {
        try await request(path, method: "POST", queryItems: [], body: try JSONEncoder().encode(body))
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
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
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
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw MattermostAPIError.decoding
        }
    }
}

private struct ServerError: Decodable {
    let message: String?
}
