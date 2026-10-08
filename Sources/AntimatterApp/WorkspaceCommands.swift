import SwiftUI

enum WorkspaceFocusTarget: Hashable {
    case sidebar
    case conversation
}

enum WorkspaceTabAction: Hashable {
    case closeSelected
    case selectPrevious
    case selectNext
}

private struct WorkspaceFocusActionKey: FocusedValueKey {
    typealias Value = (WorkspaceFocusTarget) -> Void
}

private struct WorkspaceTabActionKey: FocusedValueKey {
    typealias Value = (WorkspaceTabAction) -> Void
}

extension FocusedValues {
    var workspaceFocusAction: ((WorkspaceFocusTarget) -> Void)? {
        get { self[WorkspaceFocusActionKey.self] }
        set { self[WorkspaceFocusActionKey.self] = newValue }
    }

    var workspaceTabAction: ((WorkspaceTabAction) -> Void)? {
        get { self[WorkspaceTabActionKey.self] }
        set { self[WorkspaceTabActionKey.self] = newValue }
    }
}

func requestSettingsWindow(openWindow: (String) -> Void) {
    openWindow(SettingsWindow.sceneID)
}

struct WorkspaceCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @FocusedValue(\.workspaceFocusAction) private var focusWorkspace
    @FocusedValue(\.workspaceTabAction) private var performTabAction

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") {
                requestSettingsWindow { openWindow(id: $0) }
            }
            .keyboardShortcut(",", modifiers: [.command])
        }

        CommandGroup(after: .newItem) {
            Button("New Workspace Window") {
                openWindow(id: "workspace")
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])

            Button("Close Chat") {
                performTabAction?(.closeSelected)
            }
            .keyboardShortcut("w", modifiers: [.command])
            .disabled(performTabAction == nil)
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

            Divider()

            Button("Previous Chat") {
                performTabAction?(.selectPrevious)
            }
            .keyboardShortcut("[", modifiers: [.command])
            .disabled(performTabAction == nil)

            Button("Next Chat") {
                performTabAction?(.selectNext)
            }
            .keyboardShortcut("]", modifiers: [.command])
            .disabled(performTabAction == nil)
        }
    }
}
