import SwiftUI

struct CommandPalette: View {
    @Binding var isPresented: Bool
    let focus: (WorkspaceFocusTarget) -> Void
    let openSearch: (String) -> Void
    @State private var query = ""
    @State private var selectedCommand: PaletteCommand?
    @State private var highlightedCommandIndex = 0
    @FocusState private var isQueryFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "command")
                    .font(.system(size: 15))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                if let selectedCommand {
                    CommandChip(command: selectedCommand, remove: clearSelectedCommand)
                }
                TextField(
                    selectedCommand == nil ? "Type a command…" : "Type a query…",
                    text: $query
                )
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .foregroundStyle(WorkspaceTheme.primaryText)
                .focused($isQueryFocused)
                .onSubmit(performSubmitAction)
                .onKeyPress(.upArrow) {
                    guard selectedCommand == nil else { return .ignored }
                    moveHighlight(.up)
                    return .handled
                }
                .onKeyPress(.downArrow) {
                    guard selectedCommand == nil else { return .ignored }
                    moveHighlight(.down)
                    return .handled
                }
            }
            .padding(14)
            Divider().overlay(WorkspaceTheme.divider)

            if selectedCommand == nil {
                ForEach(Array(matchingCommands.enumerated()), id: \.element) { index, command in
                    PaletteAction(
                        command: command,
                        isHighlighted: index == highlightedCommandIndex
                    ) {
                        select(command)
                    }
                }
            }
        }
        .frame(width: 400)
        .background(WorkspaceTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.06), radius: 12, y: 5)
        .onExitCommand {
            isPresented = false
        }
        .onMoveCommand(perform: moveHighlight)
        .onChange(of: query) {
            highlightedCommandIndex = 0
        }
        .onAppear {
            DispatchQueue.main.async {
                isQueryFocused = true
            }
        }
        .accessibilityIdentifier("command-palette")
    }

    private var matchingCommands: [PaletteCommand] {
        PaletteCommand.allCases.filter {
            query.isEmpty || $0.title.localizedCaseInsensitiveContains(query)
        }
    }

    private func moveHighlight(_ direction: MoveCommandDirection) {
        guard selectedCommand == nil, !matchingCommands.isEmpty else { return }

        switch direction {
        case .up:
            highlightedCommandIndex = (highlightedCommandIndex - 1 + matchingCommands.count) % matchingCommands.count
        case .down:
            highlightedCommandIndex = (highlightedCommandIndex + 1) % matchingCommands.count
        default:
            break
        }
    }

    private func performSubmitAction() {
        if let selectedCommand {
            run(selectedCommand)
        } else if matchingCommands.indices.contains(highlightedCommandIndex) {
            select(matchingCommands[highlightedCommandIndex])
        }
    }

    private func select(_ command: PaletteCommand) {
        selectedCommand = command
        query = ""
        isQueryFocused = true
    }

    private func clearSelectedCommand() {
        selectedCommand = nil
        query = ""
        highlightedCommandIndex = 0
        isQueryFocused = true
    }

    private func run(_ command: PaletteCommand) {
        switch command {
        case .searchMessages:
            openSearch(query)
        case .focusSidebar:
            focus(.sidebar)
        case .focusConversation:
            focus(.conversation)
        }
        isPresented = false
    }
}

private enum PaletteCommand: String, CaseIterable, Identifiable {
    case searchMessages
    case focusSidebar
    case focusConversation

    var id: Self { self }

    var title: String {
        switch self {
        case .searchMessages: "Search messages"
        case .focusSidebar: "Focus sidebar"
        case .focusConversation: "Focus conversation"
        }
    }

    var symbol: String {
        switch self {
        case .searchMessages: "magnifyingglass"
        case .focusSidebar: "sidebar.left"
        case .focusConversation: "rectangle.split.3x1"
        }
    }
}

private struct CommandChip: View {
    let command: PaletteCommand
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: command.symbol)
            Text(command.title)
                .lineLimit(1)
            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(command.title)")
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(WorkspaceTheme.primaryText)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(WorkspaceTheme.divider)
        .clipShape(Capsule())
        .accessibilityIdentifier("command-palette-chip")
    }
}

private struct PaletteAction: View {
    let command: PaletteCommand
    let isHighlighted: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: command.symbol)
                    .font(.system(size: 15))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                Text(command.title)
                    .font(.system(size: 14))
                Spacer()
                Image(systemName: "return")
                    .font(.system(size: 12))
                    .foregroundStyle(WorkspaceTheme.secondaryText.opacity(0.5))
            }
            .foregroundStyle(WorkspaceTheme.primaryText)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
        }
        .buttonStyle(.plain)
        .background(isHighlighted ? WorkspaceTheme.divider : .clear)
        .accessibilityIdentifier("command-palette-\(command.rawValue)")
    }
}
