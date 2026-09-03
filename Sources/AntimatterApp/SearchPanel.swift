import AntimatterFoundation
import SwiftUI

struct SearchResultsView: View {
    @ObservedObject var search: SearchViewModel
    let channels: [MattermostChannel]
    let users: [String: MattermostUser]
    let onSelect: (MattermostPost) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if search.isSearching {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Searching messages…")
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                } else if let error = search.error {
                    Text(error).font(.system(size: 12)).foregroundStyle(WorkspaceTheme.attention)
                } else if search.posts.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(WorkspaceTheme.secondaryText)
                        Text("No messages found")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(WorkspaceTheme.primaryText)
                        Text("Try a different word or phrase.")
                            .font(.system(size: 11))
                            .foregroundStyle(WorkspaceTheme.secondaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                } else {
                    ForEach(search.posts) { post in
                        Button {
                            onSelect(post)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 5) {
                                    Text(channelName(for: post))
                                    Text("·")
                                    Text(users[post.userID]?.displayName ?? "Unknown member")
                                    Spacer(minLength: 0)
                                    Text(timestamp(for: post))
                                }
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(WorkspaceTheme.secondaryText)
                                Text(post.message)
                                    .font(.system(size: 12))
                                    .foregroundStyle(WorkspaceTheme.primaryText)
                                    .lineLimit(2)
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(WorkspaceTheme.raisedSurface.opacity(0.6), in: RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(WorkspaceTheme.canvas)
    }

    private func channelName(for post: MattermostPost) -> String {
        channels.first(where: { $0.id == post.channelID })?.displayName ?? "Conversation"
    }

    private func timestamp(for post: MattermostPost) -> String {
        Date(timeIntervalSince1970: TimeInterval(post.createAt) / 1_000)
            .formatted(date: .abbreviated, time: .shortened)
    }
}
