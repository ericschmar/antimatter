import SwiftUI

struct ChatTypingIndicator: View {
    var body: some View {
        HStack {
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(WorkspaceTheme.secondaryText.opacity(index == 1 ? 0.7 : 0.4))
                        .frame(width: 8, height: 8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(
                WorkspaceTheme.raisedSurface,
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )

            Spacer(minLength: 60)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Someone is typing")
    }
}
