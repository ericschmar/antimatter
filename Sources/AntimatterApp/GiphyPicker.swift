import AntimatterFoundation
import SwiftUI

@MainActor
private final class GiphySearchViewModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var gifs: [GiphyGIF] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?

    private let client: GiphyClient
    private var searchTask: Task<Void, Never>?

    init(client: GiphyClient) {
        self.client = client
    }

    deinit {
        searchTask?.cancel()
    }

    func loadTrending() {
        load { try await self.client.trending() }
    }

    func search() {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else {
            loadTrending()
            return
        }
        load { try await self.client.search(trimmedQuery) }
    }

    private func load(_ request: @escaping @Sendable () async throws -> [GiphyGIF]) {
        searchTask?.cancel()
        isLoading = true
        error = nil
        searchTask = Task {
            do {
                let response = try await request()
                guard !Task.isCancelled else { return }
                gifs = response
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}

struct GiphyPicker: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: GiphySearchViewModel
    let select: (GiphyGIF) -> Void

    init(client: GiphyClient, select: @escaping (GiphyGIF) -> Void) {
        _model = StateObject(wrappedValue: GiphySearchViewModel(client: client))
        self.select = select
    }

    private let columns = [
        GridItem(.adaptive(minimum: 140, maximum: 190), spacing: 8),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Search Giphy")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                Text("Choose a GIF to add to your message.")
                    .font(.system(size: 11))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }

            ClearableSearchField(placeholder: "Search for GIFs", text: $model.query)
                .onSubmit(model.search)

            Group {
                if model.isLoading {
                    ProgressView("Loading GIFs")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = model.error {
                    ContentUnavailableView(
                        "Couldn’t load GIFs",
                        systemImage: "exclamationmark.triangle",
                        description: Text(error)
                    )
                } else if model.gifs.isEmpty {
                    ContentUnavailableView(
                        "No GIFs found",
                        systemImage: "magnifyingglass",
                        description: Text("Try another search.")
                    )
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: 8) {
                            ForEach(model.gifs) { gif in
                                GifTile(gif: gif) {
                                    select(gif)
                                }
                            }
                        }
                        .padding(.trailing, 2)
                    }
                }
            }
            .frame(minHeight: 270)

            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(24)
        .frame(width: 620, height: 500)
        .background(WorkspaceTheme.surface)
        .task { model.loadTrending() }
    }
}

private struct GifTile: View {
    let gif: GiphyGIF
    let select: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: select) {
            AsyncImage(url: gif.previewURL) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                Rectangle()
                    .fill(WorkspaceTheme.raisedSurface)
                    .overlay { ProgressView() }
            }
            .frame(height: 116)
            .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous).fill(WorkspaceTheme.hoverSurface).opacity(isHovered ? 1 : 0))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .help(gif.title.isEmpty ? "Insert GIF" : gif.title)
        .accessibilityLabel(gif.title.isEmpty ? "Insert GIF" : "Insert \(gif.title)")
    }
}
