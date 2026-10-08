import AntimatterFoundation
import AppKit
import OSLog
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@main
struct AntimatterApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    private let configuration: AppConfiguration
    @StateObject private var authentication: AuthenticationViewModel
    @StateObject private var accentColorSettings = AccentColorSettings()
    @StateObject private var userColorSettings = UserColorSettings()
    @StateObject private var directMessageWindows = DirectMessageWindowRegistry()

    init() {
        let loadedConfiguration: AppConfiguration
        do {
            loadedConfiguration = try AppConfiguration.load()
        } catch {
            AppLogger.application.error("Configuration error: \(error.localizedDescription, privacy: .public)")
            loadedConfiguration = AppConfiguration(environment: .production)
        }
        configuration = loadedConfiguration
        // ponytail:diagnostic — temporary scroll-freeze instrumentation; remove with MainThreadStallLogger.swift.
        MainThreadStallLogger.start()
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
            .environmentObject(directMessageWindows)
        }
        .defaultSize(width: 1_200, height: 800)
        .windowStyle(.hiddenTitleBar)
        .commands {
            WorkspaceCommands()
        }

        WindowGroup("Direct message", for: DirectMessageWindowRoute.self) { $route in
            if let route, let session = session(for: route) {
                DirectMessageWindow(route: route, configuration: configuration, session: session)
            } else {
                Color.clear
            }
        }
        .defaultSize(width: 640, height: 760)
        .windowStyle(.hiddenTitleBar)
        .commandsRemoved()
        .environmentObject(accentColorSettings)
        .environmentObject(userColorSettings)
        .environmentObject(directMessageWindows)
    }

    private func session(for route: DirectMessageWindowRoute) -> MattermostSession? {
        ([authentication.connectedSession] + authentication.savedSessions)
            .compactMap { $0 }
            .first { $0.serverURL.absoluteString == route.serverURL }
    }
}
