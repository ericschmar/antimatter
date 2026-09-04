import AntimatterFoundation
import Foundation

@MainActor
final class ChannelFilesViewModel: ObservableObject {
    @Published private(set) var files: [MattermostFile] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?

    private let loader: MattermostTimelineLoader
    private var channelID: String?

    init(session: MattermostSession) {
        let client = MattermostAPIClient(serverURL: session.serverURL, token: session.token)
        loader = MattermostTimelineLoader(client: client)
    }

    func load(channelID: String) {
        guard self.channelID != channelID || files.isEmpty else { return }
        self.channelID = channelID
        isLoading = true
        error = nil
        Task {
            do {
                let files = try await loader.loadChannelFiles(channelID: channelID)
                guard self.channelID == channelID else { return }
                self.files = files
            } catch {
                guard self.channelID == channelID else { return }
                self.error = error.localizedDescription
            }
            guard self.channelID == channelID else { return }
            self.isLoading = false
        }
    }

    func clear() {
        channelID = nil
        files = []
        error = nil
        isLoading = false
    }
}
