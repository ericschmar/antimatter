import AntimatterFoundation
import Foundation

@MainActor
final class NavigationViewModel: ObservableObject {
    @Published private(set) var teams: [MattermostTeam] = []
    @Published private(set) var channels: [MattermostChannel] = []
    @Published private(set) var users: [String: MattermostUser] = [:]
    @Published private(set) var currentUserAvatarData: Data?
    @Published var selectedChannelID: String?
    @Published private(set) var loadError: String?
    @Published private(set) var isLoading = false

    private let loader: MattermostNavigationLoader
    private let store: MattermostLocalStore
    private let defaults: UserDefaults
    private let favoritesKey = "favoriteMattermostChannelIDs"
    private let channelOrderKey = "mattermostChannelOrder"
    private var currentUserID: String?

    init(session: MattermostSession, defaults: UserDefaults = .standard) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        loader = MattermostNavigationLoader(client: client)
        store = MattermostLocalStore(serverURL: session.serverURL)
        self.defaults = defaults
    }

    var favoriteChannels: [MattermostChannel] {
        ordered(channels.filter { favoriteIDs.contains($0.id) && $0.deleteAt == 0 }, section: "favorites")
    }

    var publicChannels: [MattermostChannel] {
        ordered(channels.filter { $0.type == "O" && !favoriteIDs.contains($0.id) && $0.deleteAt == 0 }, section: "channels")
    }

    var regularChannels: [MattermostChannel] {
        ordered(
            channels.filter {
                ($0.type == "O" || $0.type == "P") && !favoriteIDs.contains($0.id) && $0.deleteAt == 0
            },
            section: "channels"
        )
    }

    var privateChannels: [MattermostChannel] {
        ordered(channels.filter { $0.type == "P" && !favoriteIDs.contains($0.id) && $0.deleteAt == 0 }, section: "private")
    }

    var directMessages: [MattermostChannel] {
        ordered(channels.filter { $0.type == "D" && $0.deleteAt == 0 }, section: "direct")
    }

    var groupMessages: [MattermostChannel] {
        ordered(channels.filter { $0.type == "G" && $0.deleteAt == 0 }, section: "group")
    }

    var archivedChannels: [MattermostChannel] {
        ordered(channels.filter { $0.deleteAt != 0 }, section: "archived")
    }

    func load(preferredChannelID: String? = nil) async {
        guard !isLoading else { return }
        isLoading = true
        loadError = nil
        if let cached = try? await store.load() {
            teams = cached.teams
            channels = cached.channels
            users = Dictionary(uniqueKeysWithValues: cached.users.map { ($0.id, $0) })
        }
        do {
            let snapshot = try await loader.load()
            teams = snapshot.teams.sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
            channels = snapshot.channels
            users = Dictionary(uniqueKeysWithValues: snapshot.users.map { ($0.id, $0) })
            currentUserID = snapshot.currentUserID.isEmpty ? nil : snapshot.currentUserID
            try await store.apply(.navigation(teams: teams, channels: channels))
            try await store.apply(.users(snapshot.users))
            if let currentUserID, currentUserAvatarData == nil {
                currentUserAvatarData = try? await loader.loadAvatarData(userID: currentUserID)
            }
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

    func displayName(for channel: MattermostChannel) -> String {
        guard channel.type == "D" else { return channel.displayName }
        guard let userID = directMessageUserID(for: channel) else { return channel.displayName }
        return users[userID]?.displayName ?? channel.displayName
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

    func reconcile(_ event: MattermostWebSocketEvent) async {
        switch event.event {
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

    private func directMessageUserID(for channel: MattermostChannel) -> String? {
        guard let currentUserID else { return nil }
        return channel.name
            .split(separator: "_")
            .map(String.init)
            .first { $0 != currentUserID }
    }
}
