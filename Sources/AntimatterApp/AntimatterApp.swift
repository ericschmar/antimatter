import AntimatterFoundation
import OSLog
import SwiftUI

@main
struct AntimatterApp: App {
    private let configuration: AppConfiguration
    @StateObject private var authentication: AuthenticationViewModel

    init() {
        let loadedConfiguration: AppConfiguration
        do {
            loadedConfiguration = try AppConfiguration.load()
        } catch {
            AppLogger.application.error("Configuration error: \(error.localizedDescription, privacy: .public)")
            loadedConfiguration = AppConfiguration(environment: .production)
        }
        configuration = loadedConfiguration
        _authentication = StateObject(wrappedValue: AuthenticationViewModel(configuration: loadedConfiguration))
    }

    var body: some Scene {
        WindowGroup("Antimatter", id: "workspace") {
            if authentication.connectedSession == nil {
                AuthenticationScreen(model: authentication)
            } else {
                WorkspaceShell(configuration: configuration)
            }
        }
        .defaultSize(width: 1_200, height: 800)
        .commands {
            WorkspaceCommands()
        }
    }
}
