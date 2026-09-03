import AntimatterFoundation
import SwiftUI
import UniformTypeIdentifiers

struct ChannelSection: View {
    let title: String
    let sectionID: String
    let channels: [MattermostChannel]
    @ObservedObject var navigation: NavigationViewModel
    @State private var draggedChannelID: String?

    init(
        _ title: String,
        sectionID: String,
        channels: [MattermostChannel],
        navigation: NavigationViewModel
    ) {
        self.title = title
        self.sectionID = sectionID
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
                            Text(navigation.displayName(for: channel)).lineLimit(1)
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
                    }
                }
            }
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
