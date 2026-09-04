import Foundation

/// Values supplied by the host environment rather than a checked-in source file.
///
/// Server credentials deliberately do not belong here. They are stored through
/// ``SecureValueStore`` after authentication has completed.
public struct AppConfiguration: Equatable, Sendable {
    public enum Environment: String, Equatable, Sendable {
        case development
        case production
    }

    public enum ConfigurationError: Error, Equatable, LocalizedError, Sendable {
        case invalidServerURL(String)

        public var errorDescription: String? {
            switch self {
            case let .invalidServerURL(value):
                "ANTIMATTER_SERVER_URL must be an absolute HTTP or HTTPS URL, not “\(value)”."
            }
        }
    }

    public let environment: Environment
    public let initialServerURL: URL?
    /// Optional public Giphy API key used to search for GIFs from the composer.
    /// The key is intentionally read from the host environment and never persisted.
    public let giphyAPIKey: String?

    public init(
        environment: Environment,
        initialServerURL: URL? = nil,
        giphyAPIKey: String? = nil
    ) {
        self.environment = environment
        self.initialServerURL = initialServerURL
        self.giphyAPIKey = giphyAPIKey?.trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty
    }

    public static func load() throws -> AppConfiguration {
        var values = dotenvValues()
        values.merge(ProcessInfo.processInfo.environment) { _, environmentValue in environmentValue }
        return try load(environment: values)
    }

    public static func load(environment values: [String: String]) throws -> AppConfiguration {
        let environment = Environment(rawValue: values["ANTIMATTER_ENV"] ?? "") ?? .production
        let giphyAPIKey = values["GIPHY_API_KEY"]
        guard let rawURL = values["ANTIMATTER_SERVER_URL"], !rawURL.isEmpty else {
            return AppConfiguration(environment: environment, giphyAPIKey: giphyAPIKey)
        }

        guard
            let url = URL(string: rawURL),
            let scheme = url.scheme?.lowercased(),
            ["http", "https"].contains(scheme),
            url.host != nil,
            url.user == nil,
            url.password == nil,
            url.query == nil,
            url.fragment == nil
        else {
            throw ConfigurationError.invalidServerURL(rawURL)
        }

        return AppConfiguration(
            environment: environment,
            initialServerURL: url,
            giphyAPIKey: giphyAPIKey
        )
    }

    private static func dotenvValues(
        fileURL: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent(".env")
    ) -> [String: String] {
        guard let contents = try? String(contentsOf: fileURL, encoding: .utf8) else { return [:] }
        return contents
            .split(whereSeparator: \.isNewline)
            .reduce(into: [:]) { values, line in
                let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmedLine.isEmpty, !trimmedLine.hasPrefix("#") else { return }
                let assignment = trimmedLine.dropPrefix("export ").split(
                    separator: "=",
                    maxSplits: 1,
                    omittingEmptySubsequences: false
                )
                guard assignment.count == 2 else { return }
                let key = assignment[0].trimmingCharacters(in: .whitespaces)
                let value = assignment[1]
                    .trimmingCharacters(in: .whitespaces)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
                guard !key.isEmpty else { return }
                values[key] = value
            }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

private extension String {
    func dropPrefix(_ prefix: String) -> Substring {
        hasPrefix(prefix) ? dropFirst(prefix.count) : self[...]
    }
}
