import AntimatterFoundation
import SwiftUI

struct ChannelFilesAside: View {
    let files: [MattermostFile]
    let isLoading: Bool
    let error: String?
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("Files", systemImage: "folder")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .accessibilityLabel("Close channel files")
            }
            .padding(.horizontal, 14)
            .frame(height: WorkspaceTheme.headerHeight)

            Divider().overlay(WorkspaceTheme.divider)

            Group {
                if isLoading {
                    ProgressView("Loading files")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView("Couldn’t load files", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if files.isEmpty {
                    ContentUnavailableView("No files yet", systemImage: "folder", description: Text("Files shared in this channel appear here."))
                } else {
                    List(files) { file in
                        ChannelFileRow(file: file)
                    }
                    .listStyle(.plain)
                }
            }
        }
        .frame(minWidth: 240, idealWidth: 280, maxWidth: 360, maxHeight: .infinity)
        .background(WorkspaceTheme.surface)
        .accessibilityIdentifier("channel-files-aside")
    }
}

private struct ChannelFileRow: View {
    let file: MattermostFile

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: file.mimeType.hasPrefix("image/") ? "photo" : "doc")
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(file.name)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                    .lineLimit(2)
                Text(ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))
                    .font(.system(size: 11))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
        }
        .padding(.vertical, 3)
        .accessibilityLabel("\(file.name), \(ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))")
    }
}
