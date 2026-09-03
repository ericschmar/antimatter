import AntimatterFoundation
import AppKit
import EmojiKit
import SwiftUI
import SwiftEmojiPicker

struct MessageTimeline: View {
    @ObservedObject var timeline: TimelineViewModel
    @EnvironmentObject private var userColorSettings: UserColorSettings
    let knownUsers: [String: MattermostUser]
    let statuses: [String: String]
    let currentUserID: String?
    let currentUsername: String?
    let channelID: String?
    let onStartDirectMessage: (MattermostUser) -> Void
    let onReply: (MattermostPost) -> Void
    let onVote: (MattermostPost, String) -> Void
    @AppStorage("messageFontSize") private var messageFontSize = 12.0
    @AppStorage("messageGroupingIntervalMinutes") private var messageGroupingIntervalMinutes = 5.0

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if timeline.isLoading && timeline.posts.isEmpty {
                        TimelineLoadingState()
                    } else if let error = timeline.loadError {
                        TimelineStatus(message: error, isError: true)
                    } else if timeline.posts.isEmpty {
                        TimelineEmptyState()
                    } else {
                        if timeline.hasEarlierPosts {
                            ProgressView()
                                .controlSize(.small)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .accessibilityLabel("Loading earlier messages")
                                .onAppear {
                                    Task {
                                        await timeline.loadEarlierPosts()
                                    }
                                }
                        }
                        ForEach(groups) { group in
                            TimelineDateHeader(date: group.date)
                            ForEach(group.threads) { thread in
                                messageRow(for: thread.root, in: group)
                                    .id(thread.root.id)

                                if !thread.replies.isEmpty {
                                    InlineReplyThread(
                                        replies: thread.replies,
                                        users: messageUsers,
                                        statuses: messageStatuses,
                                        currentUserID: currentUserID,
                                        currentUsername: currentUsername,
                                        fileData: timeline.fileData,
                                        avatarData: timeline.avatarData,
                                        messageFontSize: messageFontSize,
                                        onStartDirectMessage: onStartDirectMessage,
                                        onReply: onReply,
                                        onEdit: timeline.beginEditing,
                                        onVote: onVote
                                    ) { post, emojiName in
                                        timeline.toggleReaction(on: post, emojiName: emojiName)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 10)
                .id(messageFontSize)
            }
            .onChange(of: newestPostID) { _, postID in
                scrollToLatest(postID, with: proxy)
            }
            .task(id: channelID) {
                await timeline.load(channelID: channelID)
                userColorSettings.assignColors(to: messageUsers.keys)
                scrollToLatest(newestPostID, with: proxy)
            }
            .onChange(of: timeline.users) {
                userColorSettings.assignColors(to: messageUsers.keys)
            }
        }
        .accessibilityLabel("Message timeline")
        .accessibilityIdentifier("message-timeline")
    }

    private var groups: [TimelineGroup] {
        Dictionary(grouping: MattermostTimelineThreading.threads(from: timeline.posts)) { thread in
            Calendar.current.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(thread.root.createAt) / 1_000))
        }
        .map { TimelineGroup(date: $0.key, threads: $0.value) }
        .sorted { $0.date < $1.date }
    }

    private var newestPostID: String? {
        timeline.posts.last?.id
    }

    private var messageUsers: [String: MattermostUser] {
        knownUsers.merging(timeline.users) { _, timelineUser in timelineUser }
    }

    private var messageStatuses: [String: String] {
        statuses.merging(timeline.statuses) { _, timelineStatus in timelineStatus }
    }

    private var messageGrouping: MattermostTimelineGrouping {
        MattermostTimelineGrouping(maximumInterval: messageGroupingIntervalMinutes * 60)
    }

    private func messageRow(for post: MattermostPost, in group: TimelineGroup) -> MessageRow {
        MessageRow(
            post: post,
            users: messageUsers,
            avatarData: timeline.avatarData[post.userID],
            fileData: timeline.fileData,
            status: timeline.statuses[post.userID] ?? statuses[post.userID],
            messageFontSize: messageFontSize,
            currentUserID: currentUserID,
            currentUsername: currentUsername,
            showsMetadata: !messageGrouping.shouldGroup(post, with: group.previousRoot(of: post)),
            onStartDirectMessage: onStartDirectMessage,
            onReply: onReply,
            onEdit: timeline.beginEditing,
            onVote: onVote,
            onToggleReaction: { post, emojiName in
                timeline.toggleReaction(on: post, emojiName: emojiName)
            }
        )
    }

    private func scrollToLatest(_ postID: String?, with proxy: ScrollViewProxy) {
        guard let postID else { return }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(postID, anchor: .bottom)
            }
        }
    }
}

private struct TimelineGroup: Identifiable {
    let date: Date
    let threads: [MattermostTimelineThread]

    var id: Date { date }

    init(date: Date, threads: [MattermostTimelineThread]) {
        self.date = date
        self.threads = threads
    }

    func previousRoot(of post: MattermostPost) -> MattermostPost? {
        guard let index = threads.firstIndex(where: { $0.root.id == post.id }), index > 0 else {
            return nil
        }
        return threads[index - 1].root
    }
}

private struct TimelineDateHeader: View {
    let date: Date

    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(WorkspaceTheme.divider)
                .frame(height: 1)
            Text(date.formatted(.dateTime.weekday(.wide).month(.wide).day().year()))
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .fixedSize()
            Rectangle()
                .fill(WorkspaceTheme.divider)
                .frame(height: 1)
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Messages from \(date.formatted(date: .long, time: .omitted))")
    }
}

private struct MessageRow: View {
    let post: MattermostPost
    let users: [String: MattermostUser]
    let avatarData: Data?
    let fileData: [String: Data]
    let status: String?
    let messageFontSize: Double
    let currentUserID: String?
    let currentUsername: String?
    let showsMetadata: Bool
    let onStartDirectMessage: (MattermostUser) -> Void
    let onReply: (MattermostPost) -> Void
    let onEdit: (MattermostPost) -> Void
    let onVote: (MattermostPost, String) -> Void
    let onToggleReaction: (MattermostPost, String) -> Void
    @EnvironmentObject private var userColorSettings: UserColorSettings
    @AppStorage("showTimelineAvatars") private var showAvatars = true
    @State private var isHovering = false
    @State private var isReactionTooltipPresented = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if showsMetadata {
                PresenceDot(status: status)
                    .padding(.top, 8)
            } else {
                Color.clear.frame(width: 5, height: 5)
            }

            if showsMetadata && showAvatars {
                Avatar(data: avatarData, initials: initials)
                    .accessibilityHidden(true)
            } else if showAvatars {
                Color.clear.frame(width: 22, height: 22)
            }

            if showsMetadata, let authorUser {
                UserProfileButton(
                    user: authorUser,
                    avatarData: avatarData,
                    onStartDirectMessage: onStartDirectMessage
                )
                .frame(width: 112, alignment: .leading)
                .padding(.top, 4)
            } else if showsMetadata {
                Text(author)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(userColorSettings.color(for: post.userID))
                    .frame(width: 112, alignment: .leading)
                    .padding(.top, 4)

                Text(timestamp)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .frame(width: 50, alignment: .trailing)
                    .padding(.top, 4)
            } else {
                Color.clear.frame(width: 112, height: 1)
                if authorUser == nil {
                    Color.clear.frame(width: 50, height: 1)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                RichMessageContent(
                    post: post,
                    fontSize: messageFontSize,
                    currentUsername: currentUsername,
                    fileData: fileData
                )
                if let poll = post.poll {
                    SocialPoll(poll: poll) { actionID in
                        onVote(post, actionID)
                    }
                }
                ReactionSummary(
                    post: post,
                    displayName: { userID in users[userID]?.displayName ?? "Unknown member" },
                    currentUserID: currentUserID,
                    onToggleReaction: onToggleReaction
                ) { isPresented in
                    isReactionTooltipPresented = isPresented
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .topTrailing) {
                if isHovering {
                    HStack(spacing: 2) {
                        AddReactionButton(post: post, onToggleReaction: onToggleReaction)
                        messageActionButton("arrowshape.turn.up.left", label: "Reply") { onReply(post) }
                        if post.userID == currentUserID {
                            messageActionButton("pencil", label: "Edit message") { onEdit(post) }
                        }
                        Menu {
                            Button("Copy message") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(post.message, forType: .string)
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 12, weight: .medium))
                                .frame(width: 26, height: 26)
                        }
                        .menuStyle(.borderlessButton)
                    }
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous)
                            .stroke(WorkspaceTheme.divider, lineWidth: 1)
                    }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 3)
        .background(isHovering ? WorkspaceTheme.hoverSurface : .clear)
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .zIndex(isReactionTooltipPresented ? 1 : 0)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .contextMenu {
            Button("Reply") { onReply(post) }
            Button("Copy message") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(post.message, forType: .string)
            }
            Divider()
            Button("Edit message") {
                onEdit(post)
            }
        }
    }

    private func messageActionButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .medium))
                .frame(width: 26, height: 26)
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
    }

    private var author: String {
        users[post.userID]?.displayName ?? "Unknown member"
    }

    private var authorUser: MattermostUser? {
        users[post.userID]
    }

    private var initials: String {
        let components = author.split(separator: " ")
        let initials = components.prefix(2).compactMap(\.first)
        return String(initials).uppercased()
    }

    private var timestamp: String {
        Date(timeIntervalSince1970: TimeInterval(post.createAt) / 1_000)
            .formatted(date: .omitted, time: .shortened)
    }

    private var accessibilityLabel: String {
        showsMetadata ? "\(author), \(timestamp), \(post.message)" : post.message
    }
}

/// A native rendering of a Matterpoll post that keeps its interactive options
/// available outside Mattermost's web client.
private struct SocialPoll: View {
    let poll: MattermostPoll
    let vote: (String) -> Void

    private var options: [MattermostPollAction] {
        poll.attachment?.actions.filter(\.isVote) ?? []
    }

    private var totalVotes: Int {
        options.reduce(0) { $0 + $1.voteCount }
    }

    private var question: String {
        poll.attachment?.title ?? poll.attachment?.text ?? "Poll"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(question)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.primaryText)
            ForEach(options) { option in
                Button {
                    vote(option.id)
                } label: {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 10)
                                .fill(WorkspaceTheme.navigationAccent.opacity(0.18))
                                .frame(width: geometry.size.width * percentage(for: option))
                            HStack(spacing: 6) {
                                Text(option.option)
                                    .font(.system(size: 14))
                                    .foregroundStyle(WorkspaceTheme.primaryText)
                                Spacer()
                                Text("\(option.voteCount)")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(WorkspaceTheme.primaryText)
                            }
                            .padding(.horizontal, 12)
                        }
                    }
                    .frame(height: 40)
                    .background(WorkspaceTheme.primaryText.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(option.option), \(option.voteCount) votes")
                .help("Vote for \(option.option)")
            }
            Text("\(totalVotes) \(totalVotes == 1 ? "vote" : "votes")")
                .font(.system(size: 12))
                .foregroundStyle(WorkspaceTheme.secondaryText)
        }
        .padding(16)
        .frame(maxWidth: 300, alignment: .leading)
        .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(WorkspaceTheme.primaryText.opacity(0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.05), radius: 14, x: 0, y: 6)
    }

    private func percentage(for option: MattermostPollAction) -> CGFloat {
        guard totalVotes > 0 else { return 0 }
        return CGFloat(option.voteCount) / CGFloat(totalVotes)
    }
}

private struct InlineReplyThread: View {
    let replies: [MattermostPost]
    let users: [String: MattermostUser]
    let statuses: [String: String]
    let currentUserID: String?
    let currentUsername: String?
    let fileData: [String: Data]
    let avatarData: [String: Data]
    let messageFontSize: Double
    let onStartDirectMessage: (MattermostUser) -> Void
    let onReply: (MattermostPost) -> Void
    let onEdit: (MattermostPost) -> Void
    let onVote: (MattermostPost, String) -> Void
    let onToggleReaction: (MattermostPost, String) -> Void
    @AppStorage("showTimelineAvatars") private var showAvatars = true
    @State private var isReactionTooltipPresented = false

    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(WorkspaceTheme.divider)
                .frame(width: 2)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(replies) { reply in
                    InlineReplyRow(
                        post: reply,
                        users: users,
                        status: statuses[reply.userID],
                        currentUserID: currentUserID,
                        currentUsername: currentUsername,
                        fileData: fileData,
                        avatarData: avatarData[reply.userID],
                        messageFontSize: messageFontSize,
                        onStartDirectMessage: onStartDirectMessage,
                        onReply: onReply,
                        onEdit: onEdit,
                        onVote: onVote,
                        onToggleReaction: onToggleReaction
                    ) { isPresented in
                        isReactionTooltipPresented = isPresented
                    }
                }
            }
            .padding(10)
        }
        .background(WorkspaceTheme.raisedSurface)
        .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))
        .padding(.leading, replyLeadingInset)
        .padding(.trailing, 18)
        .padding(.vertical, 5)
        .zIndex(isReactionTooltipPresented ? 1 : 0)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(replies.count) inline replies")
    }

    private var replyLeadingInset: CGFloat {
        let timelinePadding: CGFloat = 18
        let presenceColumn: CGFloat = 15
        let avatarColumn: CGFloat = showAvatars ? 32 : 0
        let authorColumn: CGFloat = 122
        let timeColumn: CGFloat = 60
        let replyInset: CGFloat = 10
        return timelinePadding + presenceColumn + avatarColumn + authorColumn + timeColumn + replyInset
    }
}

private struct InlineReplyRow: View {
    let post: MattermostPost
    let users: [String: MattermostUser]
    let status: String?
    let currentUserID: String?
    let currentUsername: String?
    let fileData: [String: Data]
    let avatarData: Data?
    let messageFontSize: Double
    let onStartDirectMessage: (MattermostUser) -> Void
    let onReply: (MattermostPost) -> Void
    let onEdit: (MattermostPost) -> Void
    let onVote: (MattermostPost, String) -> Void
    let onToggleReaction: (MattermostPost, String) -> Void
    let onReactionTooltipVisibilityChange: (Bool) -> Void
    @EnvironmentObject private var userColorSettings: UserColorSettings
    @State private var isReactionTooltipPresented = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                PresenceDot(status: status)
                if let authorUser {
                    UserProfileButton(
                        user: authorUser,
                        avatarData: avatarData,
                        onStartDirectMessage: onStartDirectMessage
                    )
                } else {
                    Text(author)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(userColorSettings.color(for: post.userID))
                }
                Text(timestamp)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }

            RichMessageContent(
                post: post,
                fontSize: messageFontSize,
                currentUsername: currentUsername,
                fileData: fileData
            )
            if let poll = post.poll {
                SocialPoll(poll: poll) { actionID in
                    onVote(post, actionID)
                }
            }
            ReactionSummary(
                post: post,
                displayName: { userID in users[userID]?.displayName ?? "Unknown member" },
                currentUserID: currentUserID,
                onToggleReaction: onToggleReaction
            ) { isPresented in
                isReactionTooltipPresented = isPresented
                onReactionTooltipVisibilityChange(isPresented)
            }
        }
        .contentShape(Rectangle())
        .zIndex(isReactionTooltipPresented ? 1 : 0)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(author), \(timestamp), \(post.message)")
        .contextMenu {
            Button("Reply") { onReply(post) }
            Button("Copy message") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(post.message, forType: .string)
            }
            Divider()
            Button("Edit message") {
                onEdit(post)
            }
        }
    }

    private var author: String {
        users[post.userID]?.displayName ?? "Unknown member"
    }

    private var authorUser: MattermostUser? {
        users[post.userID]
    }

    private var timestamp: String {
        Date(timeIntervalSince1970: TimeInterval(post.createAt) / 1_000)
            .formatted(date: .omitted, time: .shortened)
    }
}

private struct UserProfileButton: View {
    let user: MattermostUser
    let avatarData: Data?
    let onStartDirectMessage: (MattermostUser) -> Void
    @EnvironmentObject private var userColorSettings: UserColorSettings
    @State private var isProfilePresented = false

    var body: some View {
        Button {
            isProfilePresented = true
        } label: {
            Text(user.displayName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(userColorSettings.color(for: user.id))
        }
        .buttonStyle(.plain)
        .popover(isPresented: $isProfilePresented) {
            UserProfileCard(user: user, avatarData: avatarData) {
                isProfilePresented = false
                onStartDirectMessage(user)
            }
        }
    }
}

private struct UserProfileCard: View {
    let user: MattermostUser
    let avatarData: Data?
    let onStartDirectMessage: () -> Void
    @EnvironmentObject private var userColorSettings: UserColorSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ProfileAvatar(data: avatarData, initials: initials)

                VStack(alignment: .leading, spacing: 3) {
                    Text(user.displayName)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(userColorSettings.color(for: user.id))
                    Text("@\(user.username)")
                        .font(.system(size: 12))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                }
            }

            UserNameColorPicker(
                selectedColor: userColorSettings.hexColor(for: user.id),
                userDisplayName: user.displayName
            ) { color in
                userColorSettings.setColor(color, for: user.id)
            }

            Button("Message", action: onStartDirectMessage)
                .buttonStyle(.plain)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.canvas)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(WorkspaceTheme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .padding(16)
        .frame(width: 300)
        .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(WorkspaceTheme.divider, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.2), radius: 14, x: 0, y: 6)
    }

    private var initials: String {
        String(user.displayName.split(separator: " ").prefix(2).compactMap(\.first)).uppercased()
    }
}

private struct UserNameColorPicker: View {
    let selectedColor: String
    let userDisplayName: String
    let selectColor: (String) -> Void

    private let columns = Array(repeating: GridItem(.fixed(22), spacing: 8), count: 8)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Name color")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.secondaryText)

            LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                ForEach(UserColorSettings.palette, id: \.self) { color in
                    Button {
                        selectColor(color)
                    } label: {
                        Circle()
                            .fill(Color(hex: color))
                            .frame(width: 18, height: 18)
                            .overlay {
                                if selectedColor == color {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 8, weight: .bold))
                                        .foregroundStyle(.white)
                                }
                            }
                            .padding(2)
                            .overlay {
                                Circle()
                                    .stroke(selectedColor == color ? Color.white : Color.clear, lineWidth: 1.5)
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Use \(color) for \(userDisplayName)")
                    .accessibilityAddTraits(selectedColor == color ? .isSelected : [])
                }
            }
        }
    }
}

private struct ProfileAvatar: View {
    let data: Data?
    let initials: String

    var body: some View {
        Group {
            if let data, let image = NSImage(data: data) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(initials)
                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
        }
        .frame(width: 56, height: 56)
        .background(WorkspaceTheme.raisedSurface)
        .clipShape(Circle())
    }
}

private struct Avatar: View {
    let data: Data?
    let initials: String

    var body: some View {
        Group {
            if let data, let image = NSImage(data: data) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(initials)
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
        }
        .frame(width: 22, height: 22)
        .background(WorkspaceTheme.raisedSurface)
        .clipShape(Circle())
    }
}

private struct PresenceDot: View {
    let status: String?

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 5, height: 5)
            .accessibilityLabel(accessibilityStatus)
    }

    private var color: Color {
        switch status {
        case "online": .green
        case "away": .yellow
        case "dnd": WorkspaceTheme.attention
        default: WorkspaceTheme.secondaryText.opacity(0.55)
        }
    }

    private var accessibilityStatus: String {
        switch status {
        case "online": "Online"
        case "away": "Away"
        case "dnd": "Do not disturb"
        default: "Offline"
        }
    }
}

private struct ReactionSummary: View {
    let post: MattermostPost
    let displayName: (String) -> String
    let currentUserID: String?
    let onToggleReaction: (MattermostPost, String) -> Void
    let onTooltipVisibilityChange: (Bool) -> Void
    @State private var hoveredReactionID: String?

    var body: some View {
        HStack(spacing: 5) {
            ForEach(summaries) { summary in
                Button {
                    onToggleReaction(post, summary.emojiName)
                } label: {
                    HStack(spacing: 3) {
                        Text(displayEmoji(for: summary.emojiName))
                            .font(.system(size: 14))
                        Text("\(summary.count)")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    }
                    .foregroundStyle(WorkspaceTheme.primaryText)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(WorkspaceTheme.raisedSurface)
                    .clipShape(Capsule())
                    .overlay(
                        Capsule().stroke(
                            summary.userIDs.contains(currentUserID ?? "")
                                ? WorkspaceTheme.accent
                                : WorkspaceTheme.divider,
                            lineWidth: summary.userIDs.contains(currentUserID ?? "") ? 2 : 1
                        )
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    "\(summary.emojiName) reaction, \(summary.count)\(summary.userIDs.contains(currentUserID ?? "") ? ", selected" : "")"
                )
                .onHover { isHovering in
                    hoveredReactionID = isHovering ? summary.id : nil
                    onTooltipVisibilityChange(isHovering)
                }
                .overlay(alignment: .bottom) {
                    if hoveredReactionID == summary.id {
                        Text("\(readableName(for: summary.emojiName)) · \(summary.userIDs.map(displayName).joined(separator: ", "))")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(WorkspaceTheme.primaryText)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(
                                WorkspaceTheme.surface,
                                in: RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius)
                                    .stroke(WorkspaceTheme.divider, lineWidth: 1)
                            )
                            .fixedSize()
                            .offset(y: 30)
                            .compositingGroup()
                            .zIndex(1)
                    }
                }
                .zIndex(hoveredReactionID == summary.id ? 1 : 0)
            }

        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summaries: [ReactionCount] {
        Dictionary(grouping: post.reactions, by: \.emojiName)
            .map { ReactionCount(emojiName: $0.key, userIDs: $0.value.map(\.userID)) }
            .sorted { $0.emojiName < $1.emojiName }
    }

    private func displayEmoji(for emojiName: String) -> String {
        guard !isUnicodeEmoji(emojiName) else { return emojiName }

        let nameTokens = normalizedTokens(in: emojiName)
        guard !nameTokens.isEmpty else { return emojiName }
        return Emoji.all.first { emoji in
            let emojiNameTokens = normalizedTokens(in: emoji.unicodeName)
            return nameTokens.allSatisfy(emojiNameTokens.contains)
        }?.char ?? emojiName
    }

    private func normalizedTokens(in name: String) -> [String] {
        name
            .replacingOccurrences(of: "_", with: " ")
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .map { $0.lowercased() }
    }

    private func isUnicodeEmoji(_ emojiName: String) -> Bool {
        emojiName.unicodeScalars.contains(where: { $0.properties.isEmoji && !$0.isASCII })
    }

    private func readableName(for emojiName: String) -> String {
        switch emojiName {
        case "+1", "thumbsup": "Thumbs up"
        case "-1", "thumbsdown": "Thumbs down"
        case "white_check_mark": "Check mark"
        case "thinking_face": "Thinking face"
        default: emojiName.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

}

private struct AddReactionButton: View {
    let post: MattermostPost
    let onToggleReaction: (MattermostPost, String) -> Void
    @State private var isPickerPresented = false
    @State private var selectedEmoji = ""

    var body: some View {
        Button {
            isPickerPresented = true
        } label: {
            Image(systemName: "face.smiling")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .padding(5)
        }
        .buttonStyle(.plain)
        .popover(isPresented: $isPickerPresented, arrowEdge: .bottom) {
            EmojiPickerView(
                selectedEmoji: $selectedEmoji,
                selectedEmojiCategoryTintColor: WorkspaceTheme.accent
            )
            .frame(width: 360, height: 380)
        }
        .onChange(of: selectedEmoji) { _, emoji in
            guard !emoji.isEmpty else { return }
            onToggleReaction(post, emoji)
            selectedEmoji = ""
            isPickerPresented = false
        }
        .accessibilityLabel("Add reaction")
    }
}

private struct ReactionCount: Identifiable {
    let emojiName: String
    let userIDs: [String]

    var id: String { emojiName }
    var count: Int { userIDs.count }
}

private struct TimelineLoadingState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(0 ..< 4, id: \.self) { index in
                HStack(alignment: .top, spacing: 10) {
                    Circle()
                        .fill(WorkspaceTheme.raisedSurface)
                        .frame(width: 22, height: 22)
                    VStack(alignment: .leading, spacing: 6) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(WorkspaceTheme.raisedSurface)
                            .frame(width: index.isMultiple(of: 2) ? 120 : 88, height: 10)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(WorkspaceTheme.raisedSurface.opacity(0.8))
                            .frame(maxWidth: index.isMultiple(of: 2) ? 290 : 360)
                            .frame(height: 11)
                    }
                }
            }
        }
        .padding(.horizontal, 42)
        .padding(.top, 28)
        .redacted(reason: .placeholder)
        .accessibilityLabel("Loading messages")
    }
}

private struct TimelineEmptyState: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(WorkspaceTheme.navigationAccent)
                .frame(width: 56, height: 56)
                .background(WorkspaceTheme.navigationAccent.opacity(0.12), in: Circle())
            Text("This is the beginning of the conversation")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.primaryText)
            Text("Share an update, ask a question, or drop a file to get started.")
                .font(.system(size: 12))
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 52)
        .accessibilityLabel("No messages in this conversation yet")
    }
}

private struct TimelineStatus: View {
    let message: String
    let isError: Bool

    var body: some View {
        Text(message)
            .font(.system(size: 13))
            .foregroundStyle(isError ? WorkspaceTheme.attention : WorkspaceTheme.secondaryText)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 30)
    }
}
