import AntimatterFoundation
import SwiftUI

struct ThreadSidebar: View {
    @ObservedObject var timeline: TimelineViewModel
    let rootID: String
    let users: [String: MattermostUser]
    let statuses: [String: String]
    let currentUserID: String?
    let currentUsername: String?
    let onStartDirectMessage: (MattermostUser) -> Void
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
        MessageRow(
            post: post,
            users: users,
            avatarData: timeline.avatarData[post.userID],
            fileData: timeline.fileData,
            customEmojiData: timeline.customEmojiData,
            status: statuses[post.userID],
            messageFontSize: messageFontSize,
            currentUserID: currentUserID,
            currentUsername: currentUsername,
            showsMetadata: true,
            onStartDirectMessage: onStartDirectMessage,
            onReply: { _ in },
            onOpenThread: { _ in },
            onEdit: timeline.beginEditing,
            onDelete: timeline.delete,
            onVote: timeline.vote,
            onEndPoll: timeline.endPoll,
            onReactionTooltipChange: { _ in },
            onToggleReaction: timeline.toggleReaction
        )
        .background(isRoot ? WorkspaceTheme.raisedSurface : .clear)
        .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))
    }
}
