import AppKit
import AntimatterFoundation
@preconcurrency import QuickLookUI
import SwiftUI

struct ChannelFilesAside: View {
    let files: [MattermostFile]
    let isLoading: Bool
    let error: String?
    let onView: (MattermostFile) -> Void
    let onDownload: (MattermostFile) -> Void
    let close: () -> Void

    var body: some View {
        ConversationDrawer(title: "Files", closeLabel: "Close channel files", close: close) {
            Group {
                if isLoading {
                    ProgressView("Loading files")
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                } else if let error {
                    ContentUnavailableView("Couldn’t load files", systemImage: "exclamationmark.triangle", description: Text(error))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                } else if files.isEmpty {
                    ContentUnavailableView("No files yet", systemImage: "folder", description: Text("Files shared in this channel appear here."))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(files) { file in
                                ChannelFileRow(file: file, onView: onView, onDownload: onDownload)
                                if file.id != files.last?.id {
                                    Divider().overlay(WorkspaceTheme.divider)
                                }
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                    }
                }
            }
        }
        .accessibilityIdentifier("channel-files-aside")
    }
}

private struct ChannelFileRow: View {
    let file: MattermostFile
    let onView: (MattermostFile) -> Void
    let onDownload: (MattermostFile) -> Void

    var body: some View {
        HStack(spacing: 12) {
            FileTypeBadge(extensionName: fileExtension, color: typeColor)

            VStack(alignment: .leading, spacing: 3) {
                Text(file.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))
                    .font(.system(size: 12))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
            Spacer(minLength: 0)
            Button(action: { onView(file) }) {
                Image(systemName: "eye")
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            .foregroundStyle(WorkspaceTheme.secondaryText)
            .accessibilityLabel("View \(file.name)")
            Button(action: { onDownload(file) }) {
                Image(systemName: "arrow.down.circle")
                    .font(.system(size: 20))
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            .foregroundStyle(WorkspaceTheme.accent)
            .accessibilityLabel("Download \(file.name)")
        }
        .padding(.vertical, 12)
        .accessibilityLabel("\(file.name), \(ByteCountFormatter.string(fromByteCount: file.size, countStyle: .file))")
    }

    private var fileExtension: String {
        let value = URL(fileURLWithPath: file.name).pathExtension
        return value.isEmpty ? "FILE" : value.uppercased()
    }

    private var typeColor: Color {
        switch fileExtension {
        case "PDF": WorkspaceTheme.attention
        case "MP3", "WAV", "M4A": .orange
        case "ZIP", "RAR", "7Z": WorkspaceTheme.secondaryText
        case "PNG", "JPG", "JPEG", "GIF", "WEBP": WorkspaceTheme.accent
        default: WorkspaceTheme.accent
        }
    }
}

private struct FileTypeBadge: View {
    let extensionName: String
    let color: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(color.opacity(0.18))
            .frame(width: 38, height: 38)
            .overlay {
                Text(extensionName)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.55)
                    .padding(.horizontal, 3)
            }
    }
}

@MainActor
final class ChannelFileQuickLookPreview: NSObject, QLPreviewPanelDataSource {
    static let shared = ChannelFileQuickLookPreview()
    private var url: URL?

    func show(file: MattermostFile, data: Data) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("AntimatterChannelFiles", isDirectory: true)
        let filename = "\(file.id)-\(URL(fileURLWithPath: file.name).lastPathComponent)"
        let url = directory.appendingPathComponent(filename)

        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            self.url = url
            guard let panel = QLPreviewPanel.shared() else { return }
            panel.dataSource = self
            panel.reloadData()
            panel.makeKeyAndOrderFront(nil)
        } catch {
            return
        }
    }

    nonisolated func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        1
    }

    nonisolated func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        MainActor.assumeIsolated { url as NSURL? }
    }
}

@MainActor
enum ChannelFileDownloader {
    static func save(file: MattermostFile, data: Data) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = file.name
        panel.canCreateDirectories = true

        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? data.write(to: url, options: .atomic)
    }
}
