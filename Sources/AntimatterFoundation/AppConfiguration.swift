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

    public init(environment: Environment, initialServerURL: URL? = nil) {
        self.environment = environment
        self.initialServerURL = initialServerURL
    }

    public static func load(
        environment values: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> AppConfiguration {
        let environment = Environment(rawValue: values["ANTIMATTER_ENV"] ?? "") ?? .production
        guard let rawURL = values["ANTIMATTER_SERVER_URL"], !rawURL.isEmpty else {
            return AppConfiguration(environment: environment)
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

        return AppConfiguration(environment: environment, initialServerURL: url)
    }
}
