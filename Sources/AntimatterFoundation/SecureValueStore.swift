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
