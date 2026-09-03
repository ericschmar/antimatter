import AntimatterFoundation
import SwiftUI
import UniformTypeIdentifiers

struct ChannelSection: View {
    let title: String
    let sectionID: String
    let channels: [MattermostChannel]
    @ObservedObject var navigation: NavigationViewModel
    @ObservedObject var presence: PresenceViewModel
    let onOpenPermanently: (MattermostChannel) -> Void
    @State private var draggedChannelID: String?
    @State private var isCollapsed = false
    @State private var hoveredChannelID: String?

    init(
        _ title: String,
        sectionID: String,
        channels: [MattermostChannel],
        navigation: NavigationViewModel,
        presence: PresenceViewModel,
        onOpenPermanently: @escaping (MattermostChannel) -> Void = { _ in }
    ) {
        self.title = title
        self.sectionID = sectionID
        self.channels = channels
        self.navigation = navigation
        self.presence = presence
        self.onOpenPermanently = onOpenPermanently
    }

    var body: some View {
        if !channels.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Button {
                    isCollapsed.toggle()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                            .font(.system(size: 8, weight: .bold))
                            .frame(width: 10)
                        Text(title)
                            .font(.system(size: 10, weight: .bold))
                            .tracking(0.8)
                        Spacer(minLength: 0)
                        Text(String(channels.count))
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    }
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .frame(height: 25)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if !isCollapsed {
                    ForEach(channels) { channel in
                    Button {
                        navigation.selectedChannelID = channel.id
                    } label: {
                        HStack(spacing: 8) {
                            if channel.type == "D" {
                                DirectMessageAvatar(
                                    data: navigation.avatarData[navigation.directMessageUserID(for: channel) ?? ""],
                                    initials: String(navigation.displayName(for: channel).prefix(2)),
                                    status: navigation.directMessageUserID(for: channel).flatMap { presence.statuses[$0] }
                                )
                            } else {
                                Image(systemName: "number")
                                .font(.system(size: 11, weight: .semibold))
                            }
                            Text(navigation.displayName(for: channel)).lineLimit(1)
                            Spacer(minLength: 0)
                            if channel.mentionCount > 0 {
                                Text(String(channel.mentionCount))
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(WorkspaceTheme.attention)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(WorkspaceTheme.attention.opacity(0.16), in: Capsule())
                            } else if channel.unreadCount > 0 {
                                Text(String(channel.unreadCount))
                                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(WorkspaceTheme.secondaryText)
                            }
                            if hoveredChannelID == channel.id {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(WorkspaceTheme.secondaryText)
                                    .accessibilityHidden(true)
                            }
                        }
                        .font(.system(size: 13, weight: channel.unreadCount > 0 || navigation.selectedChannelID == channel.id ? .semibold : .regular))
                        .foregroundStyle(WorkspaceTheme.primaryText)
                        .padding(.leading, 16)
                        .padding(.trailing, 8)
                        .frame(maxWidth: .infinity)
                        .frame(height: 30)
                        .background(
                            navigation.selectedChannelID == channel.id ? WorkspaceTheme.raisedSurface : .clear,
                            in: RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous)
                        )
                        .overlay(alignment: .leading) {
                            if navigation.selectedChannelID == channel.id {
                                Rectangle()
                                    .fill(WorkspaceTheme.accent)
                                    .frame(width: 2, height: 22)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .simultaneousGesture(
                        TapGesture(count: 2).onEnded {
                            onOpenPermanently(channel)
                        }
                    )
                    .onHover { isHovered in
                        hoveredChannelID = isHovered ? channel.id : nil
                    }
                    .onDrag {
                        draggedChannelID = channel.id
                        return NSItemProvider(object: channel.id as NSString)
                    }
                    .onDrop(
                        of: [UTType.text],
                        delegate: ChannelDropDelegate(
                            destinationID: channel.id,
                            draggedChannelID: $draggedChannelID
                        ) { sourceID, destinationID in
                            guard
                                let sourceIndex = channels.firstIndex(where: { $0.id == sourceID }),
                                let destinationIndex = channels.firstIndex(where: { $0.id == destinationID }),
                                sourceIndex != destinationIndex
                            else { return }
                            navigation.reorderChannels(
                                channels,
                                from: IndexSet(integer: sourceIndex),
                                to: sourceIndex < destinationIndex ? destinationIndex + 1 : destinationIndex,
                                section: sectionID
                            )
                        }
                    )
                    .contextMenu {
                        Button("Open in workspace") {
                            navigation.selectedChannelID = channel.id
                        }
                        Button(navigation.isFavorite(channel) ? "Remove from Favorites" : "Add to Favorites") {
                            navigation.toggleFavorite(channel)
                        }
                        Divider()
                        Button(
                            navigation.isArchived(channel) ? "Unarchive chat" : "Archive chat",
                            role: navigation.isArchived(channel) ? nil : .destructive
                        ) {
                            if navigation.isArchived(channel) {
                                navigation.unarchive(channel)
                            } else {
                                navigation.archive(channel)
                            }
                        }
                    }
                    }
                }
            }
            .padding(.horizontal, 14)
        }
    }

}

private struct DirectMessageAvatar: View {
    let data: Data?
    let initials: String
    let status: String?

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let data, let image = NSImage(data: data) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Text(initials)
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                }
            }
            .frame(width: 22, height: 22)
            .background(WorkspaceTheme.raisedSurface)
            .clipShape(Circle())
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
                .overlay(Circle().stroke(WorkspaceTheme.sidebar, lineWidth: 1.5))
        }
    }

    private var statusColor: Color {
        switch status {
        case "online": .green
        case "away": .yellow
        case "dnd": WorkspaceTheme.attention
        default: WorkspaceTheme.secondaryText.opacity(0.65)
        }
    }
}

private struct ChannelDropDelegate: DropDelegate {
    let destinationID: String
    @Binding var draggedChannelID: String?
    let move: (String, String) -> Void

    func dropEntered(info: DropInfo) {
        guard let draggedChannelID else { return }
        move(draggedChannelID, destinationID)
    }

    func performDrop(info: DropInfo) -> Bool {
        draggedChannelID = nil
        return true
    }
}
