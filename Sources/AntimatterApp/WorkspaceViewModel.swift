import AntimatterFoundation
import Foundation

struct WorkspaceTab: Codable, Identifiable, Equatable {
    let channelID: String
    var title: String
    var isPreview: Bool

    var id: String { channelID }
}

@MainActor
final class WorkspaceViewModel: ObservableObject {
    @Published private(set) var tabs: [WorkspaceTab]
    @Published private(set) var selectedChannelID: String?

    private let defaults: UserDefaults
    private let tabsKey = "workspaceTabs"
    private let selectionKey = "workspaceSelectedChannelID"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        tabs = (try? JSONDecoder().decode([WorkspaceTab].self, from: defaults.data(forKey: tabsKey) ?? Data())) ?? []
        selectedChannelID = defaults.string(forKey: selectionKey)
    }

    func preview(_ channel: MattermostChannel) {
        if tabs.contains(where: { $0.channelID == channel.id }) {
            selectedChannelID = channel.id
        } else if let previewIndex = tabs.firstIndex(where: \.isPreview) {
            tabs[previewIndex] = WorkspaceTab(channelID: channel.id, title: channel.displayName, isPreview: true)
        } else {
            tabs.append(WorkspaceTab(channelID: channel.id, title: channel.displayName, isPreview: true))
        }
        selectedChannelID = channel.id
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

    private func persist() {
        defaults.set(try? JSONEncoder().encode(tabs), forKey: tabsKey)
        defaults.set(selectedChannelID, forKey: selectionKey)
    }
}
