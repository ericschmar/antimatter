import SwiftUI

struct WorkspaceTabs: View {
    @ObservedObject var workspace: WorkspaceViewModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 1) {
                ForEach(workspace.tabs) { tab in
                    HStack(spacing: 6) {
                        Button {
                            workspace.select(tab)
                        } label: {
                            Text(tab.title)
                                .lineLimit(1)
                                .font(.system(size: 12, weight: workspace.selectedChannelID == tab.channelID ? .semibold : .regular))
                        }
                        .buttonStyle(.plain)

                        if tab.isPreview {
                            Button {
                                workspace.keep(tab)
                            } label: {
                                Image(systemName: "pin")
                            }
                            .help("Keep tab open")
                        }

                        Button {
                            workspace.close(tab)
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .help("Close tab")
                    }
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                    .padding(.horizontal, 10)
                    .frame(height: WorkspaceTheme.titleHeight)
                    .background(workspace.selectedChannelID == tab.channelID ? WorkspaceTheme.raisedSurface : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))
                    .contextMenu {
                        Button("Select tab") { workspace.select(tab) }
                        if tab.isPreview {
                            Button("Keep tab open") { workspace.keep(tab) }
                        }
                        Divider()
                        Button("Close tab") { workspace.close(tab) }
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
