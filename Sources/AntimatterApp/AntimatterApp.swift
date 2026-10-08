import AntimatterFoundation
import AppKit
import OSLog
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

enum SettingsWindow {
    static let sceneID = "settings"
}

private struct SettingsWindowHost: View {
    let session: MattermostSession
    let savedSessions: [MattermostSession]
    let selectSession: (MattermostSession) -> Void
    let addAccount: () -> Void
    let disconnect: (MattermostSession?) -> Void
    @StateObject private var navigation: NavigationViewModel

    init(
        session: MattermostSession,
        savedSessions: [MattermostSession],
        selectSession: @escaping (MattermostSession) -> Void,
        addAccount: @escaping () -> Void,
        disconnect: @escaping (MattermostSession?) -> Void
    ) {
        self.session = session
        self.savedSessions = savedSessions
        self.selectSession = selectSession
        self.addAccount = addAccount
        self.disconnect = disconnect
        _navigation = StateObject(wrappedValue: NavigationViewModel(session: session))
    }

    var body: some View {
        SettingsView(
            session: session,
            channels: navigation.channels,
            savedSessions: savedSessions,
            selectSession: selectSession,
            addAccount: addAccount,
            disconnect: disconnect
        )
        .task {
            await navigation.load()
        }
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

        WindowGroup("Settings", id: SettingsWindow.sceneID) {
            Group {
                if let session = authentication.connectedSession {
                    SettingsWindowHost(
                        session: session,
                        savedSessions: authentication.savedSessions,
                        selectSession: authentication.select,
                        addAccount: authentication.addAccount,
                        disconnect: authentication.disconnect
                    )
                    .id(session.serverURL)
                } else {
                    ContentUnavailableView(
                        "Settings unavailable",
                        systemImage: "gearshape",
                        description: Text("Sign in to manage Settings.")
                    )
                }
            }
            .environmentObject(accentColorSettings)
            .environmentObject(userColorSettings)
        }
        .defaultSize(width: 780, height: 540)

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
