import AntimatterFoundation
import Foundation

@MainActor
final class NavigationViewModel: ObservableObject {
    @Published private(set) var teams: [MattermostTeam] = []
    @Published private(set) var channels: [MattermostChannel] = []
    @Published private(set) var users: [String: MattermostUser] = [:]
    @Published private(set) var avatarData: [String: Data] = [:]
    @Published private(set) var currentUserAvatarData: Data?
    @Published var selectedChannelID: String?
    @Published var selectedTeamID: String?
    @Published private(set) var loadError: String?
    @Published private(set) var isLoading = false

    private let loader: MattermostNavigationLoader
    private let store: MattermostLocalStore
    private let defaults: UserDefaults
    private let favoritesKey = "favoriteMattermostChannelIDs"
    private let channelOrderKey = "mattermostChannelOrder"
    private let selectedTeamKey = "selectedMattermostTeamID"
    private let archivedChannelKey = "archivedMattermostChannelIDs"
    private(set) var currentUserID: String?

    init(session: MattermostSession, defaults: UserDefaults = .standard) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        loader = MattermostNavigationLoader(client: client)
        store = MattermostLocalStore(serverURL: session.serverURL)
        self.defaults = defaults
        selectedTeamID = defaults.string(forKey: selectedTeamKey)
    }

    var favoriteChannels: [MattermostChannel] {
        ordered(visibleChannels.filter { favoriteIDs.contains($0.id) && !isArchived($0) }, section: "favorites")
    }

    var publicChannels: [MattermostChannel] {
        ordered(visibleChannels.filter { $0.type == "O" && !favoriteIDs.contains($0.id) && !isArchived($0) }, section: "channels")
    }

    var regularChannels: [MattermostChannel] {
        ordered(
            visibleChannels.filter {
                ($0.type == "O" || $0.type == "P") && !favoriteIDs.contains($0.id) && !isArchived($0)
            },
            section: "channels"
        )
    }

    var privateChannels: [MattermostChannel] {
        ordered(visibleChannels.filter { $0.type == "P" && !favoriteIDs.contains($0.id) && !isArchived($0) }, section: "private")
    }

    var directMessages: [MattermostChannel] {
        visibleChannels
            .filter { $0.type == "D" && !isArchived($0) }
            .sorted { $0.lastPostAt > $1.lastPostAt }
    }

    var groupMessages: [MattermostChannel] {
        ordered(visibleChannels.filter { $0.type == "G" && !isArchived($0) }, section: "group")
    }

    var archivedChannels: [MattermostChannel] {
        ordered(visibleChannels.filter(isArchived), section: "archived")
    }

    var mentionCount: Int {
        visibleChannels.reduce(0) { $0 + $1.mentionCount }
    }

    var unreadChannelCount: Int {
        visibleChannels.filter { $0.unreadCount > 0 }.count
    }

    var presenceUserIDs: Set<String> {
        var userIDs = Set(directMessages.compactMap(directMessageUserID(for:)))
        if let currentUserID {
            userIDs.insert(currentUserID)
        }
        return userIDs
    }

    func load(preferredChannelID: String? = nil) async {
        guard !isLoading else { return }
        isLoading = true
        loadError = nil
        if let cached = try? await store.load() {
            teams = cached.teams
            channels = cached.channels
            users = Dictionary(uniqueKeysWithValues: cached.users.map { ($0.id, $0) })
            selectedTeamID = cached.selectedTeamID ?? selectedTeamID
            restoreSelectedTeam()
        }
        do {
            let snapshot = try await loader.load()
            teams = snapshot.teams.sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
            channels = snapshot.channels
            restoreSelectedTeam()
            users = Dictionary(uniqueKeysWithValues: snapshot.users.map { ($0.id, $0) })
            currentUserID = snapshot.currentUserID.isEmpty ? nil : snapshot.currentUserID
            try await store.apply(.navigation(teams: teams, channels: channels))
            try await store.apply(.users(snapshot.users))
            if let currentUserID, currentUserAvatarData == nil {
                currentUserAvatarData = try? await loader.loadAvatarData(userID: currentUserID)
            }
            let directUserIDs = Set(directMessages.compactMap(directMessageUserID(for:)))
            let loadedAvatars = await withTaskGroup(of: (String, Data?).self, returning: [String: Data].self) { group in
                for userID in directUserIDs where avatarData[userID] == nil {
                    group.addTask { [loader] in
                        (userID, try? await loader.loadAvatarData(userID: userID))
                    }
                }
                var results: [String: Data] = [:]
                for await (userID, data) in group {
                    if let data { results[userID] = data }
                }
                return results
            }
            avatarData.merge(loadedAvatars) { _, new in new }
            selectedChannelID = preferredChannelID.flatMap { preferredID in
                channels.contains(where: { $0.id == preferredID }) ? preferredID : nil
            } ?? selectedChannelID ?? publicChannels.first?.id ?? directMessages.first?.id
        } catch {
            if teams.isEmpty && channels.isEmpty {
                loadError = error.localizedDescription
            }
        }
        isLoading = false
    }

    func toggleFavorite(_ channel: MattermostChannel) {
        var updated = favoriteIDs
        if updated.contains(channel.id) {
            updated.remove(channel.id)
        } else {
            updated.insert(channel.id)
        }
        defaults.set(Array(updated), forKey: favoritesKey)
        objectWillChange.send()
    }

    func isFavorite(_ channel: MattermostChannel) -> Bool {
        favoriteIDs.contains(channel.id)
    }

    func archive(_ channel: MattermostChannel) {
        var updated = archivedChannelIDs
        updated.insert(channel.id)
        defaults.set(Array(updated), forKey: archivedChannelKey)
        if selectedChannelID == channel.id {
            selectedChannelID = regularChannels.first?.id ?? directMessages.first?.id
        }
        objectWillChange.send()
    }

    func unarchive(_ channel: MattermostChannel) {
        var updated = archivedChannelIDs
        updated.remove(channel.id)
        defaults.set(Array(updated), forKey: archivedChannelKey)
        objectWillChange.send()
    }

    func isArchived(_ channel: MattermostChannel) -> Bool {
        channel.deleteAt != 0 || archivedChannelIDs.contains(channel.id)
    }

    func selectTeam(_ team: MattermostTeam) {
        guard selectedTeamID != team.id else { return }
        selectedTeamID = team.id
        defaults.set(team.id, forKey: selectedTeamKey)
        Task { [store] in
            try? await store.apply(.selectedTeam(id: team.id))
        }
        selectedChannelID = regularChannels.first?.id ?? directMessages.first?.id
    }

    func displayName(for channel: MattermostChannel) -> String {
        guard channel.type == "D" else { return channel.displayName }
        guard let userID = directMessageUserID(for: channel) else { return "You" }
        return users[userID]?.displayName ?? channel.displayName
    }

    func openDirectMessage(with user: MattermostUser) async {
        guard let currentUserID, currentUserID != user.id else { return }

        if let existingChannel = directMessages.first(where: { directMessageUserID(for: $0) == user.id }) {
            selectedChannelID = existingChannel.id
            return
        }

        do {
            let channel = try await loader.createDirectChannel(userIDs: [currentUserID, user.id])
            if !channels.contains(channel) {
                channels.append(channel)
                try? await store.apply(.navigation(teams: teams, channels: channels))
            }
            selectedChannelID = channel.id
        } catch {
            loadError = error.localizedDescription
        }
    }

    func reorderChannels(
        _ channels: [MattermostChannel],
        from source: IndexSet,
        to destination: Int,
        section: String
    ) {
        var reordered = channels
        reordered.move(fromOffsets: source, toOffset: destination)
        var order = channelOrder
        order[section] = reordered.map(\.id)
        defaults.set(order, forKey: channelOrderKey)
        objectWillChange.send()
    }

    func reconcile(_ event: MattermostWebSocketEvent, activeChannelID: String?) async {
        switch event.event {
        case "posted":
            guard let post = event.decodedData(MattermostPost.self, forKey: "post"),
                  let index = channels.firstIndex(where: { $0.id == post.channelID })
            else { return }

            channels[index].lastPostAt = max(channels[index].lastPostAt, post.createAt)
            if post.channelID != activeChannelID, post.userID != currentUserID {
                channels[index].unreadCount += 1
            }
        case "channel_updated", "channel_created":
            guard let channel = event.decodedData(MattermostChannel.self, forKey: "channel") else { return }
            channels.removeAll { $0.id == channel.id }
            channels.append(channel)
        case "channel_deleted":
            guard let channelID = event.data?["channel_id"]?.stringValue else { return }
            channels.removeAll { $0.id == channelID }
            if selectedChannelID == channelID {
                selectedChannelID = publicChannels.first?.id ?? directMessages.first?.id
            }
        case "channel_viewed", "channel_unread_updated":
            guard let channelID = event.data?["channel_id"]?.stringValue,
                  let index = channels.firstIndex(where: { $0.id == channelID }) else { return }
            if let unreadCount = event.data?["msg_count"]?.intValue {
                channels[index].unreadCount = unreadCount
            }
            if let mentionCount = event.data?["mention_count"]?.intValue {
                channels[index].mentionCount = mentionCount
            }
        default:
            return
        }
        try? await store.apply(.navigation(teams: teams, channels: channels))
    }

    private var favoriteIDs: Set<String> {
        Set(defaults.stringArray(forKey: favoritesKey) ?? [])
    }

    private var archivedChannelIDs: Set<String> {
        Set(defaults.stringArray(forKey: archivedChannelKey) ?? [])
    }

    private var visibleChannels: [MattermostChannel] {
        channels.filter {
            $0.type == "D" || $0.type == "G" || selectedTeamID == nil || $0.teamID == selectedTeamID
        }
    }

    private func ordered(_ channels: [MattermostChannel], section: String) -> [MattermostChannel] {
        let order = channelOrder[section] ?? []
        return channels.sorted {
            let leftIndex = order.firstIndex(of: $0.id) ?? .max
            let rightIndex = order.firstIndex(of: $1.id) ?? .max
            if leftIndex != rightIndex { return leftIndex < rightIndex }
            return displayName(for: $0).localizedStandardCompare(displayName(for: $1)) == .orderedAscending
        }
    }

    private var channelOrder: [String: [String]] {
        defaults.dictionary(forKey: channelOrderKey) as? [String: [String]] ?? [:]
    }

    private func restoreSelectedTeam() {
        // An empty cache is not evidence that the persisted team is invalid.
        // Keep the selection until a non-empty response can resolve it.
        guard !teams.isEmpty else { return }
        selectedTeamID = teams.contains(where: { $0.id == selectedTeamID })
            ? selectedTeamID
            : teams.first?.id
    }

    func directMessageUserID(for channel: MattermostChannel) -> String? {
        guard let currentUserID else { return nil }
        return channel.name
            .split(separator: "_")
            .map(String.init)
            .first { $0 != currentUserID }
    }
}
