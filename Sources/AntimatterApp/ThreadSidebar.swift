import AntimatterFoundation
import SwiftUI

struct ThreadSidebar: View {
    @ObservedObject var timeline: TimelineViewModel
    let rootID: String
    let users: [String: MattermostUser]
    let currentUsername: String?
    let dismiss: () -> Void
    @AppStorage("messageFontSize") private var messageFontSize = 12.0

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("\(replies.count) \(replies.count == 1 ? "reply" : "replies")")
                    .font(.system(size: 15, weight: .semibold))
                Spacer()
                Button(action: dismiss) {
                    Image(systemName: "xmark")
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close thread")
            }
            .padding(.horizontal, 14)
            .frame(height: WorkspaceTheme.headerHeight)
            Divider().overlay(WorkspaceTheme.divider)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let root { postView(root, isRoot: true) }
                    ForEach(replies) { post in postView(post, isRoot: false) }
                }
                .padding(14)
            }
        }
        .frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
        .background(WorkspaceTheme.canvas)
        .accessibilityIdentifier("thread-sidebar")
    }

    private var thread: MattermostTimelineThread? {
        MattermostTimelineThreading.threads(from: timeline.posts).first { $0.root.id == rootID }
    }

    private var root: MattermostPost? { thread?.root }
    private var replies: [MattermostPost] { thread?.replies ?? [] }

    private func postView(_ post: MattermostPost, isRoot: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(users[post.userID]?.displayName ?? "Unknown member")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.primaryText)
            RichMessageContent(
                post: post,
                fontSize: messageFontSize,
                currentUsername: currentUsername,
                fileData: timeline.fileData
            )
        }
        .padding(10)
        .background(isRoot ? WorkspaceTheme.raisedSurface : .clear)
        .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))
    }
}
