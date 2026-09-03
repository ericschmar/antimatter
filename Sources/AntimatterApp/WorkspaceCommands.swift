import SwiftUI

enum WorkspaceFocusTarget: Hashable {
    case sidebar
    case conversation
}

private struct WorkspaceFocusActionKey: FocusedValueKey {
    typealias Value = (WorkspaceFocusTarget) -> Void
}

private struct WorkspaceSettingsActionKey: FocusedValueKey {
    typealias Value = () -> Void
}

extension FocusedValues {
    var workspaceFocusAction: ((WorkspaceFocusTarget) -> Void)? {
        get { self[WorkspaceFocusActionKey.self] }
        set { self[WorkspaceFocusActionKey.self] = newValue }
    }

    var workspaceSettingsAction: (() -> Void)? {
        get { self[WorkspaceSettingsActionKey.self] }
        set { self[WorkspaceSettingsActionKey.self] = newValue }
    }
}

struct WorkspaceCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @FocusedValue(\.workspaceFocusAction) private var focusWorkspace
    @FocusedValue(\.workspaceSettingsAction) private var showSettings

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") {
                showSettings?()
            }
            .keyboardShortcut(",", modifiers: [.command])
            .disabled(showSettings == nil)
        }

        CommandGroup(after: .newItem) {
            Button("New Workspace Window") {
                openWindow(id: "workspace")
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
        }

        CommandMenu("Workspace") {
            Button("Focus Sidebar") {
                focusWorkspace?(.sidebar)
            }
            .keyboardShortcut("1", modifiers: [.command, .option])
            .disabled(focusWorkspace == nil)

            Button("Focus Conversation") {
                focusWorkspace?(.conversation)
            }
            .keyboardShortcut("2", modifiers: [.command, .option])
            .disabled(focusWorkspace == nil)
        }
    }
}
