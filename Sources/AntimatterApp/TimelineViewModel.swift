import AntimatterFoundation
import Foundation

@MainActor
final class TimelineViewModel: ObservableObject {
    @Published private(set) var posts: [MattermostPost] = []
    @Published private(set) var users: [String: MattermostUser] = [:]
    @Published private(set) var avatarData: [String: Data] = [:]
    @Published private(set) var fileData: [String: Data] = [:]
    @Published private(set) var customEmojiData: [String: Data] = [:]
    @Published private(set) var statuses: [String: String] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingEarlierPosts = false
    @Published private(set) var hasEarlierPosts = true
    @Published private(set) var loadError: String?
    @Published private(set) var editingPostID: String?
    @Published var editMessage = ""
    @Published private(set) var editError: String?

    private let loader: MattermostTimelineLoader
    private let store: MattermostLocalStore
    private let reactions: MattermostReactions
    private let customEmojis: MattermostCustomEmojiLoader
    private let editor: MattermostPostSender
    private let polls: MattermostPolls
    let mediaClient: MattermostAPIClient
    private var currentUserID: String?
    private var activeChannelID: String?
    private var nextPageIndex = 1
    private let pageSize = MattermostPage().size
    private var customEmojiIDs: [String: String]?
    private var loadingCustomEmojiCatalogTask: Task<[MattermostCustomEmoji]?, Never>?
    private var loadingFileTasks: [String: Task<Data?, Never>] = [:]
    private var loadingEmojiTasks: [String: Task<Data?, Never>] = [:]
    private var pendingVisiblePosts: [String: MattermostPost] = [:]
    private var isLoadingVisibleContent = false

    init(session: MattermostSession) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        mediaClient = client
        loader = MattermostTimelineLoader(client: client)
        reactions = MattermostReactions(client: client)
        customEmojis = MattermostCustomEmojiLoader(client: client)
        editor = MattermostPostSender(client: client)
        polls = MattermostPolls(client: client)
        store = MattermostLocalStore(serverURL: session.serverURL)
    }

    func load(channelID: String?, aroundPostID: String? = nil) async {
        guard let channelID else {
            posts = []
            loadError = nil
            activeChannelID = nil
            hasEarlierPosts = true
            nextPageIndex = 1
            return
        }

        activeChannelID = channelID
        nextPageIndex = 1
        hasEarlierPosts = true
        isLoading = true
        loadError = nil
        if let cached = try? await store.load() {
            posts = chronological(cached.posts.filter { $0.channelID == channelID })
            users.merge(Dictionary(uniqueKeysWithValues: cached.users.map { ($0.id, $0) })) { _, new in new }
            await loadAuthors(for: posts)
        }

        do {
            let recentPosts = if let aroundPostID {
                try await loader.loadPostsAround(channelID: channelID, postID: aroundPostID)
            } else {
                try await loader.loadRecentPosts(channelID: channelID)
            }
            try await store.apply(.posts(recentPosts))
            posts = chronological(recentPosts)
            await loadAuthors(for: recentPosts)
        } catch {
            if posts.isEmpty {
                loadError = error.localizedDescription
            }
        }
        isLoading = false
    }

    func loadEarlierPosts() async {
        guard let channelID = activeChannelID else {
            AppLogger.timeline.emitEvent("Earlier Posts Skipped", "reason: no active channel")
            return
        }
        guard !isLoading else {
            AppLogger.timeline.emitEvent("Earlier Posts Skipped", "reason: initial load, page: \(self.nextPageIndex)")
            return
        }
        guard !isLoadingEarlierPosts else {
            AppLogger.timeline.emitEvent("Earlier Posts Skipped", "reason: already loading, page: \(self.nextPageIndex)")
            return
        }
        guard hasEarlierPosts else {
            AppLogger.timeline.emitEvent("Earlier Posts Skipped", "reason: exhausted, page: \(self.nextPageIndex)")
            return
        }

        AppLogger.timeline.emitEvent("Earlier Posts Requested", "page: \(self.nextPageIndex), current posts: \(self.posts.count)")
        let interval = AppLogger.timeline.beginInterval("Load Earlier Posts")
        defer { AppLogger.timeline.endInterval("Load Earlier Posts", interval) }

        isLoadingEarlierPosts = true
        defer { isLoadingEarlierPosts = false }

        let page = MattermostPage(index: nextPageIndex, size: pageSize)
        let fetchInterval = AppLogger.timeline.beginInterval("Fetch Earlier Posts")
        let olderPosts: [MattermostPost]
        do {
            olderPosts = try await loader.loadRecentPosts(channelID: channelID, page: page)
        } catch {
            AppLogger.timeline.endInterval("Fetch Earlier Posts", fetchInterval)
            AppLogger.timeline.emitEvent("Earlier Posts Failed", "page: \(page.index)")
            return
        }
        AppLogger.timeline.endInterval("Fetch Earlier Posts", fetchInterval)
        guard activeChannelID == channelID else {
            AppLogger.timeline.emitEvent("Earlier Posts Discarded", "reason: channel changed, page: \(page.index)")
            return
        }

        nextPageIndex += 1
        hasEarlierPosts = olderPosts.count == pageSize
        let existingPostIDs = Set(posts.map(\.id))
        let newPosts = olderPosts.filter { !existingPostIDs.contains($0.id) }
        guard !newPosts.isEmpty else {
            AppLogger.timeline.emitEvent("Earlier Posts Discarded", "reason: duplicate page, page: \(page.index), received: \(olderPosts.count), total: \(self.posts.count)")
            return
        }

        let mergeInterval = AppLogger.timeline.beginInterval("Persist and Publish Earlier Posts")
        try? await store.apply(.posts(newPosts))
        posts = chronological(posts + newPosts)
        AppLogger.timeline.endInterval("Persist and Publish Earlier Posts", mergeInterval)
        AppLogger.timeline.emitEvent(
            "Earlier Posts Published",
            "page: \(page.index), received: \(olderPosts.count), new: \(newPosts.count), total: \(self.posts.count), has earlier: \(self.hasEarlierPosts)"
        )
        await loadAuthors(for: newPosts)
    }

    private func loadAuthors(for posts: [MattermostPost]) async {
        let interval = AppLogger.timeline.beginInterval("Load Timeline Authors")
        defer { AppLogger.timeline.endInterval("Load Timeline Authors", interval) }

        let userIDs = Array(Set(posts.flatMap { post in
            [post.userID] + post.reactions.map(\.userID)
        }))
        let usersInterval = AppLogger.timeline.beginInterval("Fetch Timeline Users")
        do {
            let fetchedUsers = try await loader.loadUsers(ids: userIDs)
            users.merge(Dictionary(uniqueKeysWithValues: fetchedUsers.map { ($0.id, $0) })) { _, new in new }
            try? await store.apply(.users(fetchedUsers))
        } catch {
            if let cached = try? await store.load() {
                users.merge(Dictionary(uniqueKeysWithValues: cached.users.map { ($0.id, $0) })) { _, new in new }
            }
        }
        AppLogger.timeline.endInterval("Fetch Timeline Users", usersInterval)

        let statusesInterval = AppLogger.timeline.beginInterval("Fetch Timeline Statuses")
        if let loadedStatuses = try? await loader.loadStatuses(userIDs: userIDs) {
            statuses.merge(Dictionary(uniqueKeysWithValues: loadedStatuses.map { ($0.userID, $0.status) })) { _, new in new }
        }
        AppLogger.timeline.endInterval("Fetch Timeline Statuses", statusesInterval)

        let avatarsInterval = AppLogger.timeline.beginInterval("Fetch Timeline Avatars")
        await withTaskGroup(of: (String, Data?).self) { group in
            for userID in userIDs where avatarData[userID] == nil {
                group.addTask { [loader] in
                    (userID, try? await loader.loadAvatarData(userID: userID))
                }
            }
            for await (userID, data) in group where data != nil {
                avatarData[userID] = data
                // ponytail:diagnostic — temporary scroll-freeze instrumentation; remove once confirmed.
                AppLogger.freeze.notice("Published Avatar: id \(userID, privacy: .public), bytes \(data?.count ?? 0)")
            }
        }
        AppLogger.timeline.endInterval("Fetch Timeline Avatars", avatarsInterval)
    }

    private func loadAttachments(for posts: [MattermostPost]) async {
        let interval = AppLogger.timeline.beginInterval("Fetch Timeline Attachments")
        defer { AppLogger.timeline.endInterval("Fetch Timeline Attachments", interval) }

        let fileIDs = Set(posts.flatMap(\.files).map(\.id))
        await withTaskGroup(of: (String, Data?).self) { group in
            for fileID in fileIDs where fileData[fileID] == nil {
                if let task = loadingFileTasks[fileID] {
                    group.addTask { (fileID, await task.value) }
                } else {
                    let task = Task { [loader] in
                        try? await loader.loadFileData(fileID: fileID)
                    }
                    loadingFileTasks[fileID] = task
                    group.addTask { (fileID, await task.value) }
                }
            }
            for await (fileID, data) in group {
                loadingFileTasks[fileID] = nil
                // ponytail:diagnostic — temporary scroll-freeze instrumentation; remove once confirmed.
                if let data {
                    fileData[fileID] = data
                    AppLogger.freeze.notice("Published File Data: id \(fileID, privacy: .public), bytes \(data.count)")
                } else {
                    AppLogger.freeze.notice("Skipped File Data: id \(fileID, privacy: .public), reason: load failed, will refetch on next appear")
                }
            }
        }
    }

    /// Fetches media and custom reaction artwork only after its message is
    /// rendered by the lazy timeline.
    func loadVisibleContent(for posts: [MattermostPost]) async {
        for post in posts {
            pendingVisiblePosts[post.id] = post
        }
        guard !isLoadingVisibleContent else { return }

        isLoadingVisibleContent = true
        defer { isLoadingVisibleContent = false }
        await Task.yield()
        while !pendingVisiblePosts.isEmpty {
            let visiblePosts = Array(pendingVisiblePosts.values)
            pendingVisiblePosts = [:]
            let interval = AppLogger.timeline.beginInterval("Load Visible Timeline Content")
            await loadAttachments(for: visiblePosts)
            await loadCustomEmoji(for: visiblePosts)
            AppLogger.timeline.endInterval("Load Visible Timeline Content", interval)
        }
    }

    private func loadCustomEmoji(for posts: [MattermostPost]) async {
        let interval = AppLogger.timeline.beginInterval("Fetch Timeline Custom Emoji")
        defer { AppLogger.timeline.endInterval("Fetch Timeline Custom Emoji", interval) }

        if customEmojiIDs == nil {
            let emojis: [MattermostCustomEmoji]?
            if let loadingCustomEmojiCatalogTask {
                emojis = await loadingCustomEmojiCatalogTask.value
            } else {
                let task = Task { [customEmojis] in
                    try? await customEmojis.loadAll()
                }
                loadingCustomEmojiCatalogTask = task
                emojis = await task.value
                loadingCustomEmojiCatalogTask = nil
            }
            guard let emojis else { return }
            customEmojiIDs = Dictionary(uniqueKeysWithValues: emojis.map { ($0.name, $0.id) })
        }

        guard let customEmojiIDs else { return }
        let reactionNames = Set(posts.flatMap(\.reactions).map(\.emojiName))
        await withTaskGroup(of: (String, Data?).self) { group in
            for name in reactionNames where customEmojiData[name] == nil {
                guard let emojiID = customEmojiIDs[name] else { continue }
                if let task = loadingEmojiTasks[name] {
                    group.addTask { (name, await task.value) }
                } else {
                    let task = Task { [customEmojis] in
                        try? await customEmojis.loadImageData(emojiID: emojiID)
                    }
                    loadingEmojiTasks[name] = task
                    group.addTask { (name, await task.value) }
                }
            }
            for await (name, data) in group {
                loadingEmojiTasks[name] = nil
                if let data {
                    customEmojiData[name] = data
                    // ponytail:diagnostic — temporary scroll-freeze instrumentation; remove once confirmed.
                    AppLogger.freeze.notice("Published Custom Emoji: name \(name, privacy: .public), bytes \(data.count)")
                }
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
                rootID: post.rootID,
                files: post.files,
                reactions: updatedReactions,
                poll: post.poll
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

    func vote(on post: MattermostPost, actionID: String) {
        Task {
            do {
                let updatedPost = try await polls.vote(postID: post.id, actionID: actionID)
                replace(updatedPost)
                try? await store.apply(.posts([updatedPost]))
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    func endPoll(_ post: MattermostPost) {
        guard let pollID = post.poll?.pollID else { return }
        Task {
            do {
                let updatedPost = try await polls.end(postID: post.id, channelID: post.channelID, pollID: pollID)
                replace(updatedPost)
                try? await store.apply(.posts([updatedPost]))
            } catch {
                loadError = error.localizedDescription
            }
        }
    }

    func delete(_ post: MattermostPost) {
        Task {
            do {
                try await editor.delete(postID: post.id)
                posts.removeAll { $0.id == post.id }
                try? await store.apply(.removePost(id: post.id))
            } catch {
                loadError = error.localizedDescription
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
            await loadAuthors(for: [post])
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
                rootID: post.rootID,
                files: post.files,
                reactions: updatedReactions,
                poll: post.poll
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
