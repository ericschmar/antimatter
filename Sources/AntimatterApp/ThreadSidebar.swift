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
        ConversationDrawer(
            title: "\(replies.count) \(replies.count == 1 ? "reply" : "replies")",
            closeLabel: "Close thread",
            close: dismiss
        ) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if let root { postView(root, isRoot: true) }
                    ForEach(replies) { post in postView(post, isRoot: false) }
                }
                .padding(.vertical, 14)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
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
            mediaClient: timeline.mediaClient,
            showsMetadata: true,
            horizontalInset: 0,
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
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
