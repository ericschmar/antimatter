import SwiftUI

struct ConversationDrawer<Content: View>: View {
    let title: String
    let closeLabel: String
    let close: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark")
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .accessibilityLabel(closeLabel)
            }
            .padding(.horizontal, 14)
            .frame(height: WorkspaceTheme.headerHeight)

            Divider().overlay(WorkspaceTheme.divider)

            content
        }
        .frame(minWidth: 320, maxWidth: .infinity)
        .background(WorkspaceTheme.canvas)
    }
}
