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
            FoundationReadyView(configuration: configuration)
        }
        .defaultSize(width: 1_200, height: 800)
    }
}

private struct FoundationReadyView: View {
    let configuration: AppConfiguration

    var body: some View {
        ContentUnavailableView {
            Label("Antimatter", systemImage: "bubble.left.and.bubble.right")
        } description: {
            Text("The native workspace is being prepared.")
        }
        .accessibilityIdentifier("foundation-ready-view")
        .task {
            AppLogger.application.info("Native application launched in \(configuration.environment.rawValue, privacy: .public) mode.")
        }
    }
}
