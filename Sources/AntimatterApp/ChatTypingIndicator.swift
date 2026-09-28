import SwiftUI

struct ChatTypingIndicator: View {
    var names: [String] = []

    var body: some View {
        HStack(spacing: 7) {
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(WorkspaceTheme.secondaryText.opacity(index == 1 ? 0.7 : 0.4))
                        .frame(width: 5, height: 5)
                }
            }
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(WorkspaceTheme.raisedSurface, in: Capsule(style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private var label: String {
        switch names.count {
        case 0: "Someone is typing"
        case 1: "\(names[0]) is typing"
        case 2: "\(names[0]) and \(names[1]) are typing"
        default: "\(names[0]) and \(names.count - 1) others are typing"
        }
    }
}
