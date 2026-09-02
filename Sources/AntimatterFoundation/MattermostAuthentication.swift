import Foundation

public struct MattermostSession: Equatable, Sendable {
    public let serverURL: URL
    public let token: String

    public init(serverURL: URL, token: String) {
        self.serverURL = serverURL
        self.token = token
    }
}

public enum MattermostAuthenticationError: Error, Equatable, LocalizedError, Sendable {
    case invalidResponse
    case rejected(Int)
    case missingToken
    case invalidSSOCallback

    public var errorDescription: String? {
        switch self {
        case .invalidResponse: "The server returned an invalid response."
        case let .rejected(status): "Sign in was rejected (HTTP \(status))."
        case .missingToken: "The server did not return a session token."
        case .invalidSSOCallback: "The SSO callback could not be verified."
        }
    }
}

public actor MattermostAuthenticator {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func signInWithPassword(
        serverURL: URL,
        loginID: String,
        password: String
    ) async throws -> MattermostSession {
        var request = URLRequest(url: endpoint("/api/v4/users/login", on: serverURL))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(LoginRequest(loginID: loginID, password: password))
        return try await performTokenRequest(request, serverURL: serverURL)
    }

    public func signInWithPersonalAccessToken(
        serverURL: URL,
        token: String
    ) async throws -> MattermostSession {
        var request = URLRequest(url: endpoint("/api/v4/users/me", on: serverURL))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw MattermostAuthenticationError.invalidResponse
        }
        guard (200 ..< 300).contains(response.statusCode) else {
            throw MattermostAuthenticationError.rejected(response.statusCode)
        }
        return MattermostSession(serverURL: serverURL, token: token)
    }

    public func completeSAMLSignIn(
        serverURL: URL,
        callbackURL: URL,
        expectedClientToken: String
    ) async throws -> MattermostSession {
        guard
            callbackURL.queryItem(named: "client_token") == expectedClientToken,
            let serverToken = callbackURL.queryItem(named: "server_token"),
            !serverToken.isEmpty
        else {
            throw MattermostAuthenticationError.invalidSSOCallback
        }

        var request = URLRequest(url: endpoint("/api/v4/users/login/desktop_token", on: serverURL))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(DesktopTokenRequest(token: serverToken))
        return try await performTokenRequest(request, serverURL: serverURL)
    }

    public func samlLoginURL(serverURL: URL, clientToken: String) -> URL {
        var components = URLComponents(url: endpoint("/login/sso/saml", on: serverURL), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "desktop_token", value: clientToken)]
        return components.url!
    }

    private func performTokenRequest(
        _ request: URLRequest,
        serverURL: URL
    ) async throws -> MattermostSession {
        let (_, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw MattermostAuthenticationError.invalidResponse
        }
        guard (200 ..< 300).contains(response.statusCode) else {
            throw MattermostAuthenticationError.rejected(response.statusCode)
        }
        guard let token = response.value(forHTTPHeaderField: "Token"), !token.isEmpty else {
            throw MattermostAuthenticationError.missingToken
        }
        return MattermostSession(serverURL: serverURL, token: token)
    }

    private func endpoint(_ path: String, on serverURL: URL) -> URL {
        URL(string: path, relativeTo: serverURL)!.absoluteURL
    }
}

private struct LoginRequest: Encodable {
    let loginID: String
    let password: String

    enum CodingKeys: String, CodingKey {
        case loginID = "login_id"
        case password
    }
}

private struct DesktopTokenRequest: Encodable {
    let token: String
    let deviceID = ""

    enum CodingKeys: String, CodingKey {
        case token
        case deviceID = "device_id"
    }
}

private extension URL {
    func queryItem(named name: String) -> String? {
        URLComponents(url: self, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == name })?
            .value
    }
}
