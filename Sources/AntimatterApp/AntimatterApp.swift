import AntimatterFoundation
import OSLog
import SwiftUI

@main
struct AntimatterApp: App {
    private let configuration: AppConfiguration
    @StateObject private var authentication: AuthenticationViewModel
    @StateObject private var accentColorSettings = AccentColorSettings()
    @StateObject private var userColorSettings = UserColorSettings()

    init() {
        let loadedConfiguration: AppConfiguration
        do {
            loadedConfiguration = try AppConfiguration.load()
        } catch {
            AppLogger.application.error("Configuration error: \(error.localizedDescription, privacy: .public)")
            loadedConfiguration = AppConfiguration(environment: .production)
        }
        configuration = loadedConfiguration
        AppLogger.application.notice(
            "Giphy API key configured: \(loadedConfiguration.giphyAPIKey != nil, privacy: .public)"
        )
        _authentication = StateObject(wrappedValue: AuthenticationViewModel(configuration: loadedConfiguration))
    }

    var body: some Scene {
        WindowGroup("Antimatter", id: "workspace") {
            Group {
                if authentication.connectedSession == nil {
                    AuthenticationScreen(model: authentication)
                } else {
                    WorkspaceShell(
                        configuration: configuration,
                        session: authentication.connectedSession!,
                        savedSessions: authentication.savedSessions,
                        selectSession: authentication.select,
                        addAccount: authentication.addAccount,
                        disconnect: authentication.disconnect
                    )
                    .id(authentication.connectedSession!.serverURL)
                }
            }
            .environmentObject(accentColorSettings)
            .environmentObject(userColorSettings)
        }
        .defaultSize(width: 1_200, height: 800)
        .windowStyle(.hiddenTitleBar)
        .commands {
            WorkspaceCommands()
        }
    }
}
