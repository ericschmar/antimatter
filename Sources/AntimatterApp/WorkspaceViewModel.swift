import AntimatterFoundation
import Foundation

struct WorkspaceTab: Codable, Identifiable, Equatable {
    private static let searchTabPrefix = "search:"

    let channelID: String
    var title: String
    var isPreview: Bool

    var id: String { channelID }
    var isSearchResults: Bool { channelID.hasPrefix(Self.searchTabPrefix) }

    static func searchResults(query: String) -> WorkspaceTab {
        WorkspaceTab(
            channelID: "\(searchTabPrefix)\(query)",
            title: "Search: \(query)",
            isPreview: false
        )
    }
}

@MainActor
final class WorkspaceViewModel: ObservableObject {
    @Published private(set) var tabs: [WorkspaceTab]
    @Published private(set) var selectedChannelID: String?
    @Published private(set) var focusedPostID: String?

    private let defaults: UserDefaults
    private let tabsKey = "workspaceTabs"
    private let selectionKey = "workspaceSelectedChannelID"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        tabs = (try? JSONDecoder().decode([WorkspaceTab].self, from: defaults.data(forKey: tabsKey) ?? Data())) ?? []
        selectedChannelID = defaults.string(forKey: selectionKey)
    }

    func preview(_ channel: MattermostChannel, title: String? = nil) {
        let tabTitle = title ?? channel.displayName
        if let existingIndex = tabs.firstIndex(where: { $0.channelID == channel.id }) {
            tabs[existingIndex].title = tabTitle
            selectedChannelID = channel.id
        } else if let previewIndex = tabs.firstIndex(where: \.isPreview) {
            tabs[previewIndex] = WorkspaceTab(channelID: channel.id, title: tabTitle, isPreview: true)
        } else {
            tabs.append(WorkspaceTab(channelID: channel.id, title: tabTitle, isPreview: true))
        }
        selectedChannelID = channel.id
        persist()
    }

    func openPermanently(_ channel: MattermostChannel, title: String? = nil, focusedPostID: String? = nil) {
        let tabTitle = title ?? channel.displayName
        if let existingIndex = tabs.firstIndex(where: { $0.channelID == channel.id }) {
            tabs[existingIndex].title = tabTitle
            tabs[existingIndex].isPreview = false
        } else {
            tabs.append(WorkspaceTab(channelID: channel.id, title: tabTitle, isPreview: false))
        }
        selectedChannelID = channel.id
        self.focusedPostID = focusedPostID
        persist()
    }

    func clearFocusedPost(id: String) {
        guard focusedPostID == id else { return }
        focusedPostID = nil
    }

    func openSearchResults(for query: String) {
        let tab = WorkspaceTab.searchResults(query: query)
        if let existingIndex = tabs.firstIndex(where: { $0.channelID == tab.channelID }) {
            tabs[existingIndex] = tab
        } else {
            tabs.append(tab)
        }
        selectedChannelID = tab.channelID
        persist()
    }

    func select(_ tab: WorkspaceTab) {
        selectedChannelID = tab.channelID
        persist()
    }

    func keep(_ tab: WorkspaceTab) {
        guard let index = tabs.firstIndex(of: tab) else { return }
        tabs[index].isPreview = false
        persist()
    }

    func close(_ tab: WorkspaceTab) {
        guard let index = tabs.firstIndex(of: tab) else { return }
        tabs.remove(at: index)
        if selectedChannelID == tab.channelID {
            selectedChannelID = tabs.indices.contains(index) ? tabs[index].channelID : tabs.last?.channelID
        }
        persist()
    }

    func closeSelected() {
        guard let selectedTab = tabs.first(where: { $0.channelID == selectedChannelID }) else { return }
        close(selectedTab)
    }

    func selectPrevious() {
        selectRelative(to: -1)
    }

    func selectNext() {
        selectRelative(to: 1)
    }

    var isSearchResultsSelected: Bool {
        tabs.first(where: { $0.channelID == selectedChannelID })?.isSearchResults ?? false
    }

    private func selectRelative(to offset: Int) {
        guard !tabs.isEmpty else { return }

        let selectedIndex = tabs.firstIndex(where: { $0.channelID == selectedChannelID }) ?? 0
        let nextIndex = (selectedIndex + offset + tabs.count) % tabs.count
        select(tabs[nextIndex])
    }

    private func persist() {
        defaults.set(try? JSONEncoder().encode(tabs), forKey: tabsKey)
        defaults.set(selectedChannelID, forKey: selectionKey)
    }
}
