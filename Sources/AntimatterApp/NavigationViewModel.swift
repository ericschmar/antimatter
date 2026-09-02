import AntimatterFoundation
import Foundation

@MainActor
final class NavigationViewModel: ObservableObject {
    @Published private(set) var teams: [MattermostTeam] = []
    @Published private(set) var channels: [MattermostChannel] = []
    @Published var selectedChannelID: String?
    @Published private(set) var loadError: String?
    @Published private(set) var isLoading = false

    private let loader: MattermostNavigationLoader
    private let store: MattermostLocalStore
    private let defaults: UserDefaults
    private let favoritesKey = "favoriteMattermostChannelIDs"

    init(session: MattermostSession, defaults: UserDefaults = .standard) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        loader = MattermostNavigationLoader(client: client)
        store = MattermostLocalStore(serverURL: session.serverURL)
        self.defaults = defaults
    }

    var favoriteChannels: [MattermostChannel] {
        ordered(channels.filter { favoriteIDs.contains($0.id) && $0.deleteAt == 0 })
    }

    var publicChannels: [MattermostChannel] {
        ordered(channels.filter { $0.type == "O" && !favoriteIDs.contains($0.id) && $0.deleteAt == 0 })
    }

    var privateChannels: [MattermostChannel] {
        ordered(channels.filter { $0.type == "P" && !favoriteIDs.contains($0.id) && $0.deleteAt == 0 })
    }

    var directMessages: [MattermostChannel] {
        ordered(channels.filter { $0.type == "D" && $0.deleteAt == 0 })
    }

    var groupMessages: [MattermostChannel] {
        ordered(channels.filter { $0.type == "G" && $0.deleteAt == 0 })
    }

    var archivedChannels: [MattermostChannel] {
        ordered(channels.filter { $0.deleteAt != 0 })
    }

    func load(preferredChannelID: String? = nil) async {
        guard !isLoading else { return }
        isLoading = true
        loadError = nil
        if let cached = try? await store.load() {
            teams = cached.teams
            channels = cached.channels
        }
        do {
            let snapshot = try await loader.load()
            teams = snapshot.teams.sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
            channels = snapshot.channels
            try await store.apply(.navigation(teams: teams, channels: channels))
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
    }

    func isFavorite(_ channel: MattermostChannel) -> Bool {
        favoriteIDs.contains(channel.id)
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

    private func ordered(_ channels: [MattermostChannel]) -> [MattermostChannel] {
        channels.sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
    }
}
