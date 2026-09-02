import AntimatterFoundation
import Foundation

@MainActor
final class TimelineViewModel: ObservableObject {
    @Published private(set) var posts: [MattermostPost] = []
    @Published private(set) var isLoading = false
    @Published private(set) var loadError: String?

    private let loader: MattermostTimelineLoader
    private let store: MattermostLocalStore
    private let reactions: MattermostReactions
    private var currentUserID: String?

    init(session: MattermostSession) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        loader = MattermostTimelineLoader(client: client)
        reactions = MattermostReactions(client: client)
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

    func toggleReaction(on post: MattermostPost, emojiName: String) {
        Task {
            if currentUserID == nil {
                currentUserID = try? await reactions.currentUserID()
            }
            guard let currentUserID else { return }

            let existing = post.reactions.first {
                $0.userID == currentUserID && $0.emojiName == emojiName
            }
            let updatedReactions = existing == nil
                ? post.reactions + [MattermostReaction(userID: currentUserID, postID: post.id, emojiName: emojiName)]
                : post.reactions.filter { $0.id != existing?.id }
            let updatedPost = MattermostPost(
                id: post.id,
                channelID: post.channelID,
                userID: post.userID,
                message: post.message,
                createAt: post.createAt,
                updateAt: post.updateAt,
                files: post.files,
                reactions: updatedReactions
            )
            replace(updatedPost)
            try? await store.apply(.posts([updatedPost]))

            do {
                if existing == nil {
                    try await reactions.add(postID: post.id, emojiName: emojiName, userID: currentUserID)
                } else {
                    try await reactions.remove(postID: post.id, emojiName: emojiName, userID: currentUserID)
                }
            } catch {
                replace(post)
                try? await store.apply(.posts([post]))
            }
        }
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
        case "reaction_added", "reaction_removed":
            guard let reaction = event.decodedData(MattermostReaction.self, forKey: "reaction"),
                  let post = posts.first(where: { $0.id == reaction.postID }) else { return }
            let updatedReactions = event.event == "reaction_added"
                ? post.reactions.filter { $0.id != reaction.id } + [reaction]
                : post.reactions.filter { $0.id != reaction.id }
            let updatedPost = MattermostPost(
                id: post.id,
                channelID: post.channelID,
                userID: post.userID,
                message: post.message,
                createAt: post.createAt,
                updateAt: post.updateAt,
                files: post.files,
                reactions: updatedReactions
            )
            replace(updatedPost)
            try? await store.apply(.posts([updatedPost]))
        default:
            return
        }
    }

    private func chronological(_ posts: [MattermostPost]) -> [MattermostPost] {
        posts.sorted { $0.createAt < $1.createAt }
    }

    private func replace(_ post: MattermostPost) {
        posts = chronological(posts.filter { $0.id != post.id } + [post])
    }
}
