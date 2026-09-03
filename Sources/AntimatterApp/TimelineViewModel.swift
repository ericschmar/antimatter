import AntimatterFoundation
import Foundation

@MainActor
final class TimelineViewModel: ObservableObject {
    @Published private(set) var posts: [MattermostPost] = []
    @Published private(set) var users: [String: MattermostUser] = [:]
    @Published private(set) var avatarData: [String: Data] = [:]
    @Published private(set) var fileData: [String: Data] = [:]
    @Published private(set) var statuses: [String: String] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var loadError: String?
    @Published private(set) var editingPostID: String?
    @Published var editMessage = ""
    @Published private(set) var editError: String?

    private let loader: MattermostTimelineLoader
    private let store: MattermostLocalStore
    private let reactions: MattermostReactions
    private let editor: MattermostPostSender
    private var currentUserID: String?

    init(session: MattermostSession) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        loader = MattermostTimelineLoader(client: client)
        reactions = MattermostReactions(client: client)
        editor = MattermostPostSender(client: client)
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
            users.merge(Dictionary(uniqueKeysWithValues: cached.users.map { ($0.id, $0) })) { _, new in new }
            await loadAuthors(for: posts)
            await loadImageAttachments(for: posts)
        }

        do {
            let recentPosts = try await loader.loadRecentPosts(channelID: channelID)
            try await store.apply(.posts(recentPosts))
            posts = chronological(recentPosts)
            await loadAuthors(for: recentPosts)
            await loadImageAttachments(for: recentPosts)
        } catch {
            if posts.isEmpty {
                loadError = error.localizedDescription
            }
        }
        isLoading = false
    }

    private func loadAuthors(for posts: [MattermostPost]) async {
        let userIDs = Array(Set(posts.flatMap { post in
            [post.userID] + post.reactions.map(\.userID)
        }))
        do {
            let fetchedUsers = try await loader.loadUsers(ids: userIDs)
            users.merge(Dictionary(uniqueKeysWithValues: fetchedUsers.map { ($0.id, $0) })) { _, new in new }
            try? await store.apply(.users(fetchedUsers))
        } catch {
            if let cached = try? await store.load() {
                users.merge(Dictionary(uniqueKeysWithValues: cached.users.map { ($0.id, $0) })) { _, new in new }
            }
        }

        if let loadedStatuses = try? await loader.loadStatuses(userIDs: userIDs) {
            statuses.merge(Dictionary(uniqueKeysWithValues: loadedStatuses.map { ($0.userID, $0.status) })) { _, new in new }
        }

        await withTaskGroup(of: (String, Data?).self) { group in
            for userID in userIDs where avatarData[userID] == nil {
                group.addTask { [loader] in
                    (userID, try? await loader.loadAvatarData(userID: userID))
                }
            }
            for await (userID, data) in group where data != nil {
                avatarData[userID] = data
            }
        }
    }

    private func loadImageAttachments(for posts: [MattermostPost]) async {
        let imageFileIDs = Set(
            posts
                .flatMap(\.files)
                .filter { $0.mimeType.hasPrefix("image/") }
                .map(\.id)
        )
        await withTaskGroup(of: (String, Data?).self) { group in
            for fileID in imageFileIDs where fileData[fileID] == nil {
                group.addTask { [loader] in
                    (fileID, try? await loader.loadFileData(fileID: fileID))
                }
            }
            for await (fileID, data) in group where data != nil {
                fileData[fileID] = data
            }
        }
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
            await loadImageAttachments(for: [post])
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

    func appendSentPost(_ post: MattermostPost) async {
        replace(post)
        try? await store.apply(.posts([post]))
        await loadImageAttachments(for: [post])
    }

    func beginEditing(_ post: MattermostPost) {
        editingPostID = post.id
        editMessage = post.message
        editError = nil
    }

    func cancelEditing() {
        editingPostID = nil
        editMessage = ""
        editError = nil
    }

    func saveEdit(_ post: MattermostPost) {
        let message = editMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        Task {
            do {
                let updated = try await editor.update(MattermostPostUpdate(id: post.id, message: message))
                replace(updated)
                try? await store.apply(.posts([updated]))
                cancelEditing()
            } catch {
                editError = error.localizedDescription
            }
        }
    }
}
