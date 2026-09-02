import AntimatterFoundation
import OSLog
import SwiftUI

@main
struct AntimatterApp: App {
    private let configuration: AppConfiguration

    init() {
        do {
            configuration = try AppConfiguration.load()
        } catch {
            AppLogger.application.error("Configuration error: \(error.localizedDescription, privacy: .public)")
            configuration = AppConfiguration(environment: .production)
        }
    }

    var body: some Scene {
        WindowGroup("Antimatter") {
            WorkspaceShell(configuration: configuration)
        }
        .defaultSize(width: 1_200, height: 800)
    }
}
