import AntimatterFoundation
import Foundation

@MainActor
final class TimelineViewModel: ObservableObject {
    @Published private(set) var posts: [MattermostPost] = []
    @Published private(set) var isLoading = false
    @Published private(set) var loadError: String?

    private let loader: MattermostTimelineLoader
    private let store: MattermostLocalStore

    init(session: MattermostSession) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        loader = MattermostTimelineLoader(client: client)
        store = MattermostLocalStore(serverURL: session.serverURL)
    }

    func load(channelID: String?) async {
        guard let channelID else {
            posts = []
            loadError = nil
            return
        }

        isLoading = true
        loadError = nil
        if let cached = try? await store.load() {
            posts = chronological(cached.posts.filter { $0.channelID == channelID })
        }

        do {
            let recentPosts = try await loader.loadRecentPosts(channelID: channelID)
            try await store.apply(.posts(recentPosts))
            posts = chronological(recentPosts)
        } catch {
            if posts.isEmpty {
                loadError = error.localizedDescription
            }
        }
        isLoading = false
    }

    func reconcile(_ event: MattermostWebSocketEvent, activeChannelID: String?) async {
        try? await store.reconcile(event)
        guard let activeChannelID else { return }

        switch event.event {
        case "posted", "post_edited":
            guard let post = event.decodedData(MattermostPost.self, forKey: "post"),
                  post.channelID == activeChannelID else { return }
            posts = chronological(posts.filter { $0.id != post.id } + [post])
        case "post_deleted":
            guard let postID = event.data?["post_id"]?.stringValue else { return }
            posts.removeAll { $0.id == postID }
        default:
            return
        }
    }

    private func chronological(_ posts: [MattermostPost]) -> [MattermostPost] {
        posts.sorted { $0.createAt < $1.createAt }
    }
}
