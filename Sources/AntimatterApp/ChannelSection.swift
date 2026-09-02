import AntimatterFoundation
import SwiftUI

struct ChannelSection: View {
    let title: String
    let channels: [MattermostChannel]
    @ObservedObject var navigation: NavigationViewModel

    init(_ title: String, channels: [MattermostChannel], navigation: NavigationViewModel) {
        self.title = title
        self.channels = channels
        self.navigation = navigation
    }

    var body: some View {
        if !channels.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.7)
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 3)

                ForEach(channels) { channel in
                    Button {
                        navigation.selectedChannelID = channel.id
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: channel.type == "O" || channel.type == "P" ? "number" : "person")
                                .font(.system(size: 11, weight: .semibold))
                            Text(channel.displayName).lineLimit(1)
                            Spacer(minLength: 0)
                            if channel.mentionCount > 0 {
                                Text(String(channel.mentionCount))
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(WorkspaceTheme.attention)
                            } else if channel.unreadCount > 0 {
                                Circle().fill(WorkspaceTheme.accent).frame(width: 6, height: 6)
                            }
                        }
                        .font(.system(size: 13))
                        .foregroundStyle(WorkspaceTheme.primaryText)
                        .padding(.horizontal, 14)
                        .frame(height: 27)
                        .background(navigation.selectedChannelID == channel.id ? WorkspaceTheme.raisedSurface : .clear)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Open in workspace") {
                            navigation.selectedChannelID = channel.id
                        }
                        Button(navigation.isFavorite(channel) ? "Remove from Favorites" : "Add to Favorites") {
                            navigation.toggleFavorite(channel)
                        }
                    }
                }
            }
        }
    }
}
