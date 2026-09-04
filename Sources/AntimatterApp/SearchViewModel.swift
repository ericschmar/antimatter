import AntimatterFoundation
import Foundation

@MainActor
final class SearchViewModel: ObservableObject {
    @Published var query = ""
    @Published var filters = MattermostPostSearchFilters()
    @Published private(set) var posts: [MattermostPost] = []
    @Published private(set) var isSearching = false
    @Published private(set) var hasSearched = false
    @Published private(set) var error: String?

    private let loader: MattermostSearchLoader

    init(session: MattermostSession) {
        loader = MattermostSearchLoader(
            client: MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        )
    }

    func search() async {
        let terms = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !terms.isEmpty || filters.hasActiveFilters else {
            posts = []
            hasSearched = false
            return
        }
        hasSearched = true
        isSearching = true
        posts = []
        error = nil
        do {
            posts = try await loader.searchPosts(terms: terms, filters: filters)
        } catch {
            self.error = error.localizedDescription
        }
        isSearching = false
    }
}
