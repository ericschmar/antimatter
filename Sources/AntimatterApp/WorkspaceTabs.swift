import SwiftUI
import UniformTypeIdentifiers

struct WorkspaceTabs: View {
    @ObservedObject var workspace: WorkspaceViewModel
    @ObservedObject var navigation: NavigationViewModel
    @State private var draggingTab: WorkspaceTab?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 3) {
                ForEach(workspace.tabs) { tab in
                    WorkspaceTabItem(tab: tab, workspace: workspace, navigation: navigation)
                        .onDrag {
                            draggingTab = tab
                            return NSItemProvider(object: tab.channelID as NSString)
                        }
                        .onDrop(of: [.text], delegate: TabDropDelegate(
                            target: tab,
                            workspace: workspace,
                            dragging: $draggingTab
                        ))
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
        }
        .frame(height: WorkspaceTheme.titleHeight + 2)
        .background(WindowDragHandle())
        .background(WorkspaceTheme.sidebar)
        .overlay(alignment: .bottom) {
            Divider().overlay(WorkspaceTheme.divider)
        }
        .onDrop(of: [.text], delegate: TabBarDropDelegate(dragging: $draggingTab))
    }
}

private struct WindowDragHandle: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        WindowDragView()
    }

    func updateNSView(_ view: NSView, context: Context) {}

    private final class WindowDragView: NSView {
        override func mouseDown(with event: NSEvent) {
            window?.performDrag(with: event)
        }
    }
}


private struct TabDropDelegate: DropDelegate {
    let target: WorkspaceTab
    let workspace: WorkspaceViewModel
    @Binding var dragging: WorkspaceTab?

    func dropEntered(info: DropInfo) {
        guard let dragging, dragging != target,
              let from = workspace.tabs.firstIndex(of: dragging),
              let to = workspace.tabs.firstIndex(of: target)
        else { return }
        withAnimation(.easeInOut(duration: 0.15)) {
            workspace.move(from: from, to: to)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        dragging = nil
        return true
    }
}

private struct TabBarDropDelegate: DropDelegate {
    @Binding var dragging: WorkspaceTab?

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        dragging = nil
        return true
    }
}

private struct WorkspaceTabItem: View {
    let tab: WorkspaceTab
    @ObservedObject var workspace: WorkspaceViewModel
    @ObservedObject var navigation: NavigationViewModel
    @State private var isHovering = false

    private var isSelected: Bool {
        workspace.selectedChannelID == tab.channelID
    }

    var body: some View {
        HStack(spacing: 6) {
            Button {
                workspace.select(tab)
            } label: {
                HStack(spacing: 6) {
                    if let avatar = directMessageAvatar {
                        TabAvatar(data: avatar.data, initials: avatar.initials)
                    }

                    if tab.isPreview {
                        Circle()
                            .fill(WorkspaceTheme.secondaryText.opacity(0.7))
                            .frame(width: 5, height: 5)
                    }

                    Text(tab.title)
                        .lineLimit(1)
                        .font(.system(size: 12, weight: isSelected ? .medium : .regular))
                        .italic(tab.isPreview)
                }
            }
            .buttonStyle(.plain)
            .simultaneousGesture(
                TapGesture(count: 2).onEnded {
                    workspace.keep(tab)
                }
            )

            Button {
                workspace.close(tab)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .semibold))
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.plain)
            .foregroundStyle(WorkspaceTheme.secondaryText)
            .opacity(isHovering || isSelected ? 1 : 0)
            .help("Close tab")
        }
        .foregroundStyle(isSelected ? WorkspaceTheme.primaryText : WorkspaceTheme.secondaryText)
        .padding(.leading, 10)
        .padding(.trailing, 3)
        .frame(height: WorkspaceTheme.titleHeight - 6)
        .background(tabBackground, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .onHover { isHovering = $0 }
        .contextMenu {
            Button("Select tab") { workspace.select(tab) }
            if tab.isPreview {
                Button("Keep tab open") { workspace.keep(tab) }
            }
            Divider()
            Button("Close tab") { workspace.close(tab) }
        }
    }

    private var tabBackground: Color {
        if isSelected {
            return WorkspaceTheme.raisedSurface
        }
        return isHovering ? WorkspaceTheme.hoverSurface : .clear
    }

    private var directMessageAvatar: (data: Data?, initials: String)? {
        guard
            let channel = navigation.channels.first(where: { $0.id == tab.channelID }),
            channel.type == "D",
            let userID = navigation.directMessageUserID(for: channel)
        else { return nil }
        return (navigation.avatarData[userID], String(navigation.displayName(for: channel).prefix(2)))
    }
}

private struct TabAvatar: View {
    let data: Data?
    let initials: String

    var body: some View {
        Group {
            if let data, let image = NSImage(data: data) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(initials)
                    .font(.system(size: 7, weight: .bold, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
        }
        .frame(width: 14, height: 14)
        .background(WorkspaceTheme.raisedSurface)
        .clipShape(Circle())
    }
}
