import AntimatterFoundation
import AppKit
import AuthenticationServices
import Foundation

@MainActor
final class AuthenticationViewModel: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    enum Method: String, CaseIterable, Identifiable {
        case personalAccessToken
        case password
        case saml

        var id: Self { self }
        var label: String {
            switch self {
            case .personalAccessToken: "Token"
            case .password: "Password"
            case .saml: "SSO"
            }
        }
    }

    @Published var method: Method = .personalAccessToken
    @Published var serverURL: String
    @Published var loginID = ""
    @Published var password = ""
    @Published var token = ""
    @Published private(set) var isWorking = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var connectedSession: MattermostSession?

    private let authenticator = MattermostAuthenticator()
    private let secrets: SecureValueStore
    private var webAuthenticationSession: ASWebAuthenticationSession?

    init(configuration: AppConfiguration, secrets: SecureValueStore = KeychainStore()) {
        serverURL = configuration.initialServerURL?.absoluteString
            ?? UserDefaults.standard.string(forKey: "lastMattermostServerURL")
            ?? ""
        self.secrets = secrets
    }

    func submit() {
        guard let serverURL = validatedServerURL() else { return }
        errorMessage = nil

        if method == .saml {
            beginSAMLSignIn(serverURL: serverURL)
            return
        }

        isWorking = true
        Task {
            do {
                let session: MattermostSession
                switch method {
                case .personalAccessToken:
                    session = try await authenticator.signInWithPersonalAccessToken(
                        serverURL: serverURL,
                        token: token
                    )
                case .password:
                    session = try await authenticator.signInWithPassword(
                        serverURL: serverURL,
                        loginID: loginID,
                        password: password
                    )
                case .saml:
                    return
                }
                complete(session)
            } catch {
                fail(error)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
    }

    private func beginSAMLSignIn(serverURL: URL) {
        isWorking = true
        let clientToken = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        Task {
            let loginURL = await authenticator.samlLoginURL(serverURL: serverURL, clientToken: clientToken)
            let webSession = ASWebAuthenticationSession(
                url: loginURL,
                callbackURLScheme: "mattermost-dev"
            ) { [weak self] callbackURL, error in
                Task { @MainActor in
                    guard let self else { return }
                    guard let callbackURL else {
                        self.fail(error ?? MattermostAuthenticationError.invalidSSOCallback)
                        return
                    }
                    do {
                        let session = try await self.authenticator.completeSAMLSignIn(
                            serverURL: serverURL,
                            callbackURL: callbackURL,
                            expectedClientToken: clientToken
                        )
                        self.complete(session)
                    } catch {
                        self.fail(error)
                    }
                }
            }
            webSession.presentationContextProvider = self
            webAuthenticationSession = webSession
            guard webSession.start() else {
                fail(MattermostAuthenticationError.invalidResponse)
                return
            }
        }
    }

    private func complete(_ session: MattermostSession) {
        do {
            try secrets.save(
                Data(session.token.utf8),
                account: session.serverURL.absoluteString,
                service: "com.antimatter.desktop.mattermost"
            )
            UserDefaults.standard.set(session.serverURL.absoluteString, forKey: "lastMattermostServerURL")
            password = ""
            token = ""
            connectedSession = session
            isWorking = false
            AppLogger.application.info("Authenticated with \(session.serverURL.host() ?? "unknown server", privacy: .public).")
        } catch {
            fail(error)
        }
    }

    private func fail(_ error: Error) {
        isWorking = false
        errorMessage = error.localizedDescription
        AppLogger.application.error("Authentication failed: \(error.localizedDescription, privacy: .public)")
    }

    private func validatedServerURL() -> URL? {
        do {
            return try AppConfiguration.load(
                environment: ["ANTIMATTER_SERVER_URL": serverURL.trimmingCharacters(in: .whitespacesAndNewlines)]
            ).initialServerURL
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}
