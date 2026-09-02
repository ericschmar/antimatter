import SwiftUI

struct CommandPalette: View {
    @Binding var isPresented: Bool
    let focus: (WorkspaceFocusTarget) -> Void
    let openSearch: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                Text("Command palette")
                    .font(.system(size: 14, weight: .medium))
                Spacer()
                Text("esc")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
            .padding(14)
            Divider().overlay(WorkspaceTheme.divider)

            PaletteAction("Search messages", symbol: "magnifyingglass") {
                openSearch()
                isPresented = false
            }
            PaletteAction("Focus sidebar", symbol: "sidebar.left") {
                focus(.sidebar)
                isPresented = false
            }
            PaletteAction("Focus conversation", symbol: "rectangle.split.3x1") {
                focus(.conversation)
                isPresented = false
            }
        }
        .frame(width: 360)
        .background(WorkspaceTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(WorkspaceTheme.divider, lineWidth: 1))
        .accessibilityIdentifier("command-palette")
    }
}

private struct PaletteAction: View {
    let title: String
    let symbol: String
    let action: () -> Void

    init(_ title: String, symbol: String, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 13))
                .foregroundStyle(WorkspaceTheme.primaryText)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }
}
