import SwiftUI

struct WorkspaceTabs: View {
    @ObservedObject var workspace: WorkspaceViewModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 3) {
                ForEach(workspace.tabs) { tab in
                    WorkspaceTabItem(tab: tab, workspace: workspace)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
        }
        .frame(height: WorkspaceTheme.titleHeight + 2)
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

    private var isSelected: Bool {
        workspace.selectedChannelID == tab.channelID
    }

    var body: some View {
        HStack(spacing: 6) {
            Button {
                workspace.select(tab)
            } label: {
                HStack(spacing: 6) {
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

            Button {
                workspace.close(tab)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .semibold))
                    .frame(width: 18, height: 18)
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
}
