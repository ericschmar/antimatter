import Foundation

public struct GiphyGIF: Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let previewURL: URL
    public let mediaURL: URL

    public init(id: String, title: String, previewURL: URL, mediaURL: URL) {
        self.id = id
        self.title = title
        self.previewURL = previewURL
        self.mediaURL = mediaURL
    }
}

public enum GiphyAPIError: Error, Equatable, LocalizedError, Sendable {
    case invalidResponse
    case rejected(status: Int, message: String?)
    case decoding

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "Giphy returned an invalid response."
        case let .rejected(status, message):
            message ?? "Giphy request failed (HTTP \(status))."
        case .decoding:
            "Giphy returned GIF data in an unexpected format."
        }
    }
}

/// Small wrapper around Giphy's public search API. A dedicated SDK is unnecessary
/// here: searching requires one GET request and the app only needs image URLs.
public actor GiphyClient {
    private let apiKey: String
    private let session: URLSession
    private let endpoint = URL(string: "https://api.giphy.com/v1/gifs")!

    public init(apiKey: String, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.session = session
    }

    public func trending(limit: Int = 24) async throws -> [GiphyGIF] {
        try await load(path: "trending", limit: limit, queryItems: [])
    }

    public func search(_ query: String, limit: Int = 24) async throws -> [GiphyGIF] {
        try await load(
            path: "search",
            limit: limit,
            queryItems: [URLQueryItem(name: "q", value: query)]
        )
    }

    private func load(path: String, limit: Int, queryItems: [URLQueryItem]) async throws -> [GiphyGIF] {
        var components = URLComponents(url: endpoint.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "api_key", value: apiKey),
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), 50))),
            URLQueryItem(name: "rating", value: "pg-13"),
        ] + queryItems
        let (data, response) = try await session.data(from: components.url!)
        guard let response = response as? HTTPURLResponse else {
            throw GiphyAPIError.invalidResponse
        }
        guard (200 ..< 300).contains(response.statusCode) else {
            throw GiphyAPIError.rejected(
                status: response.statusCode,
                message: try? JSONDecoder().decode(GiphyErrorResponse.self, from: data).message
            )
        }
        do {
            return try JSONDecoder().decode(GiphyResponse.self, from: data).gifs.map {
                GiphyGIF(
                    id: $0.id,
                    title: $0.title,
                    previewURL: $0.images.fixedWidth.url,
                    mediaURL: $0.images.original.url
                )
            }
        } catch {
            throw GiphyAPIError.decoding
        }
    }
}

private struct GiphyResponse: Decodable {
    let gifs: [GIF]

    enum CodingKeys: String, CodingKey {
        case gifs = "data"
    }

    struct GIF: Decodable {
        let id: String
        let title: String
        let images: Images
    }

    struct Images: Decodable {
        let fixedWidth: Image
        let original: Image

        enum CodingKeys: String, CodingKey {
            case fixedWidth = "fixed_width"
            case original
        }
    }

    struct Image: Decodable {
        let url: URL
    }
}

private struct GiphyErrorResponse: Decodable {
    let message: String?
}
