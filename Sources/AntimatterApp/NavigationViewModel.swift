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
    private let defaults: UserDefaults
    private let favoritesKey = "favoriteMattermostChannelIDs"

    init(session: MattermostSession, defaults: UserDefaults = .standard) {
        loader = MattermostNavigationLoader(
            client: MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        )
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

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        loadError = nil
        do {
            let snapshot = try await loader.load()
            teams = snapshot.teams.sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
            channels = snapshot.channels
            selectedChannelID = selectedChannelID ?? publicChannels.first?.id ?? directMessages.first?.id
        } catch {
            loadError = error.localizedDescription
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

    private var favoriteIDs: Set<String> {
        Set(defaults.stringArray(forKey: favoritesKey) ?? [])
    }

    private func ordered(_ channels: [MattermostChannel]) -> [MattermostChannel] {
        channels.sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
    }
}
