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
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Search Giphy")
                        .font(.system(size: 20, weight: .semibold))
                    Text("Choose a GIF to add to your message.")
                        .font(.system(size: 12))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                }
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.plain)
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }

            HStack(spacing: 8) {
                TextField("Search for GIFs", text: $model.query)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(model.search)
                Button("Search", action: model.search)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

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
                                Button {
                                    select(gif)
                                } label: {
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
                                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .help(gif.title.isEmpty ? "Insert GIF" : gif.title)
                                .accessibilityLabel(gif.title.isEmpty ? "Insert GIF" : "Insert \(gif.title)")
                            }
                        }
                        .padding(.trailing, 2)
                    }
                }
            }
            .frame(minHeight: 270)
        }
        .padding(20)
        .frame(width: 620, height: 500)
        .task { model.loadTrending() }
    }
}
