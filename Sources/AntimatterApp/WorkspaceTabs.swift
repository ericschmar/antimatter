import SwiftUI

struct WorkspaceTabs: View {
    @ObservedObject var workspace: WorkspaceViewModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(workspace.tabs.indices, id: \.self) { index in
                    WorkspaceTabItem(tab: workspace.tabs[index], workspace: workspace)

                    if workspace.tabs.count > 1 && index < workspace.tabs.index(before: workspace.tabs.endIndex) {
                        Divider()
                            .overlay(WorkspaceTheme.divider)
                            .frame(height: 18)
                    }
                }
            }
            .padding(.horizontal, 8)
        }
        .background(WorkspaceTheme.sidebar)
        .overlay(alignment: .bottom) {
            Divider().overlay(WorkspaceTheme.divider)
        }
    }
}

private struct WorkspaceTabItem: View {
    let tab: WorkspaceTab
    @ObservedObject var workspace: WorkspaceViewModel
    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 6) {
            Button {
                workspace.select(tab)
            } label: {
                Text(tab.title)
                    .lineLimit(1)
                    .font(.system(size: 12, weight: workspace.selectedChannelID == tab.channelID ? .semibold : .regular))
            }
            .buttonStyle(.plain)

            if isHovering, tab.isPreview {
                ghostButton("pin", size: 8, help: "Keep tab open") {
                    workspace.keep(tab)
                }
            }

            if isHovering {
                ghostButton("xmark", size: 10, help: "Close tab") {
                    workspace.close(tab)
                }
            }
        }
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(workspace.selectedChannelID == tab.channelID ? WorkspaceTheme.primaryText : WorkspaceTheme.secondaryText)
        .padding(.horizontal, 10)
        .frame(height: WorkspaceTheme.titleHeight)
        .background(workspace.selectedChannelID == tab.channelID ? WorkspaceTheme.surface : .clear)
        .overlay(alignment: .bottom) {
            if workspace.selectedChannelID == tab.channelID {
                Capsule()
                    .fill(WorkspaceTheme.accent)
                    .frame(height: 2)
                    .padding(.horizontal, 8)
            }
        }
        .contentShape(Rectangle())
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

    private func ghostButton(_ symbol: String, size: CGFloat, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .semibold))
                .frame(width: 16, height: 16)
        }
        .buttonStyle(.plain)
        .foregroundStyle(WorkspaceTheme.secondaryText)
        .help(help)
    }
}
