import Foundation
import Security

/// Storage boundary for secrets such as Mattermost access tokens.
///
/// Callers provide an account identifier; this type never logs stored values.
public protocol SecureValueStore: Sendable {
    func save(_ value: Data, account: String, service: String) throws
    func value(account: String, service: String) throws -> Data?
    func removeValue(account: String, service: String) throws
}

public enum SecureValueStoreError: Error, Equatable, LocalizedError, Sendable {
    case unexpectedStatus(OSStatus)

    public var errorDescription: String? {
        switch self {
        case let .unexpectedStatus(status):
            "Keychain operation failed with status \(status)."
        }
    }
}

public struct KeychainStore: SecureValueStore {
    public init() {}

    public func save(_ value: Data, account: String, service: String) throws {
        try removeValue(account: account, service: service)

        let query = baseQuery(account: account, service: service).merging(
            [kSecValueData as String: value]
        ) { _, new in new }
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw SecureValueStoreError.unexpectedStatus(status)
        }
    }

    public func value(account: String, service: String) throws -> Data? {
        let query = baseQuery(account: account, service: service).merging(
            [
                kSecMatchLimit as String: kSecMatchLimitOne,
                kSecReturnData as String: true,
            ]
        ) { _, new in new }

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            return result as? Data
        case errSecItemNotFound:
            return nil
        default:
            throw SecureValueStoreError.unexpectedStatus(status)
        }
    }

    public func removeValue(account: String, service: String) throws {
        let status = SecItemDelete(baseQuery(account: account, service: service) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecureValueStoreError.unexpectedStatus(status)
        }
    }

    private func baseQuery(account: String, service: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrService as String: service,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
    }
}

/// Persists the non-secret server address in user defaults and its corresponding
/// session token in the Keychain.
public struct MattermostSessionStore {
    public static let keychainService = "com.antimatter.desktop.mattermost"

    private static let lastServerURLKey = "lastMattermostServerURL"
    private static let savedServerURLsKey = "savedMattermostServerURLs"

    private let secrets: any SecureValueStore
    private let defaults: UserDefaults

    public init(
        secrets: any SecureValueStore = KeychainStore(),
        defaults: UserDefaults = .standard
    ) {
        self.secrets = secrets
        self.defaults = defaults
    }

    public func save(_ session: MattermostSession) throws {
        try secrets.save(
            Data(session.token.utf8),
            account: session.serverURL.absoluteString,
            service: Self.keychainService
        )
        saveServerURLs([session.serverURL.absoluteString] + savedServerURLs().filter { $0 != session.serverURL.absoluteString })
        defaults.set(session.serverURL.absoluteString, forKey: Self.lastServerURLKey)
    }

    public func sessions() throws -> [MattermostSession] {
        var savedSessions: [MattermostSession] = []
        for rawURL in savedServerURLs() {
            guard let session = try restore(serverURL: URL(string: rawURL)) else { continue }
            savedSessions.append(session)
        }
        return savedSessions
    }

    public func select(_ serverURL: URL) throws {
        guard try restore(serverURL: serverURL) != nil else { return }
        defaults.set(serverURL.absoluteString, forKey: Self.lastServerURLKey)
        saveServerURLs([serverURL.absoluteString] + savedServerURLs().filter { $0 != serverURL.absoluteString })
    }

    public func restore(serverURL preferredServerURL: URL? = nil) throws -> MattermostSession? {
        guard
            let rawURL = preferredServerURL?.absoluteString
                ?? defaults.string(forKey: Self.lastServerURLKey),
            let serverURL = URL(string: rawURL),
            let data = try secrets.value(account: rawURL, service: Self.keychainService),
            let token = String(data: data, encoding: .utf8),
            !token.isEmpty
        else {
            return nil
        }
        return MattermostSession(serverURL: serverURL, token: token)
    }

    public func remove(serverURL preferredServerURL: URL? = nil) throws {
        guard let rawURL = preferredServerURL?.absoluteString
            ?? defaults.string(forKey: Self.lastServerURLKey)
        else {
            return
        }
        try secrets.removeValue(account: rawURL, service: Self.keychainService)
        let remainingURLs = savedServerURLs().filter { $0 != rawURL }
        saveServerURLs(remainingURLs)
        if defaults.string(forKey: Self.lastServerURLKey) == rawURL {
            if let nextURL = remainingURLs.first {
                defaults.set(nextURL, forKey: Self.lastServerURLKey)
            } else {
                defaults.removeObject(forKey: Self.lastServerURLKey)
            }
        }
    }

    private func savedServerURLs() -> [String] {
        let savedURLs = defaults.stringArray(forKey: Self.savedServerURLsKey) ?? []
        if savedURLs.isEmpty, let lastURL = defaults.string(forKey: Self.lastServerURLKey) {
            return [lastURL]
        }
        return savedURLs
    }

    private func saveServerURLs(_ serverURLs: [String]) {
        defaults.set(serverURLs, forKey: Self.savedServerURLsKey)
    }
}
