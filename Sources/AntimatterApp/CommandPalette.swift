import SwiftUI

struct CommandPalette: View {
    @Binding var isPresented: Bool
    let focus: (WorkspaceFocusTarget) -> Void
    let openSearch: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "command")
                    .font(.system(size: 15))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                Text("Type a command or search…")
                    .font(.system(size: 15))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                Spacer()
            }
            .padding(14)
            Divider().overlay(WorkspaceTheme.divider)

            PaletteAction(title: "Search messages", symbol: "magnifyingglass") {
                openSearch()
                isPresented = false
            }
            PaletteAction(title: "Focus sidebar", symbol: "sidebar.left") {
                focus(.sidebar)
                isPresented = false
            }
            PaletteAction(title: "Focus conversation", symbol: "rectangle.split.3x1") {
                focus(.conversation)
                isPresented = false
            }
        }
        .frame(width: 320)
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
        .accessibilityIdentifier("command-palette")
    }
}

private struct PaletteAction: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 15))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                Text(title)
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
    }
}
