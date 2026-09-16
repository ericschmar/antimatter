import AntimatterFoundation
import AppKit
import EmojiData
import SwiftUI
import SwiftEmojiPicker

/// Narrows row inputs to the file data a single post can display, so a publish
/// for one message's attachment does not invalidate every other row's input.
func slicedFileData(from all: [String: Data], for files: [MattermostFile]) -> [String: Data] {
    files.reduce(into: [String: Data]()) { slice, file in
        if let data = all[file.id] { slice[file.id] = data }
    }
}

/// Narrows row inputs to the custom emoji artwork a post's reactions can display.
func slicedEmojiData(from all: [String: Data], reactions: [MattermostReaction]) -> [String: Data] {
    Set(reactions.lazy.map(\.emojiName)).reduce(into: [String: Data]()) { slice, name in
        if let data = all[name] { slice[name] = data }
    }
}

/// Narrows row inputs to the users a row can display (author + co-reactors).
func slicedUsers(from all: [String: MattermostUser], userIDs: Set<String>) -> [String: MattermostUser] {
    userIDs.reduce(into: [String: MattermostUser]()) { slice, userID in
        if let user = all[userID] { slice[userID] = user }
    }
}

/// Narrows row inputs to the presence statuses of the users a thread can display.
func slicedStatuses(from all: [String: String], userIDs: Set<String>) -> [String: String] {
    userIDs.reduce(into: [String: String]()) { slice, userID in
        if let status = all[userID] { slice[userID] = status }
    }
}

/// The userIDs visible within one post's row: its author plus everyone who reacted.
func postUserIDs(_ post: MattermostPost) -> Set<String> {
    Set([post.userID] + post.reactions.map(\.userID))
}

/// The userIDs visible within an inline reply thread: reply authors plus everyone who reacted.
func threadUserIDs(_ replies: [MattermostPost]) -> Set<String> {
    Set(replies.flatMap { [$0.userID] + $0.reactions.map(\.userID) })
}

struct MessageTimeline: View {
    @ObservedObject var timeline: TimelineViewModel
    let knownUsers: [String: MattermostUser]
    let statuses: [String: String]
    let currentUserID: String?
    let currentUsername: String?
    let channelID: String?
    let focusedPostID: String?
    let onStartDirectMessage: (MattermostUser) -> Void
    let onReply: (MattermostPost) -> Void
    let onOpenThread: (MattermostPost) -> Void
    let onVote: (MattermostPost, String) -> Void
    let onFocusedPostDisplayed: (String) -> Void
    @AppStorage("messageFontSize") private var messageFontSize = 12.0
    @AppStorage("appFontFamily") private var appFontFamily = AppFontFamily.system.rawValue
    @AppStorage("messageGroupingIntervalMinutes") private var messageGroupingIntervalMinutes = 5.0
    @State private var reactionTooltip: ReactionTooltip?
    @State private var items: [TimelineItem] = []

    private static var rendersInlineReplyThreads: Bool {
        ProcessInfo.processInfo.environment["ANTIMATTER_DISABLE_INLINE_REPLY_THREADS"] != "1"
    }

    var body: some View {
        ScrollViewReader { proxy in
            GeometryReader { geometry in
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
                                        AppLogger.timeline.emitEvent("Earlier Posts Sentinel Appeared")
                                        Task {
                                            await timeline.loadEarlierPosts()
                                        }
                                    }
                            }

                            ForEach(items) { item in
                                switch item {
                                case .header(let date):
                                    TimelineDateHeader(date: date)
                                case .thread(let thread, let previousRoot):
                                    messageRow(for: thread.root, previousRoot: previousRoot)
                                        .id(thread.root.id)

                                    if Self.rendersInlineReplyThreads && !thread.replies.isEmpty {
                                        InlineReplyThread(
                                            replies: thread.replies,
                                            users: slicedUsers(from: messageUsers, userIDs: threadUserIDs(thread.replies)),
                                            statuses: slicedStatuses(from: messageStatuses, userIDs: threadUserIDs(thread.replies)),
                                            currentUserID: currentUserID,
                                            currentUsername: currentUsername,
                                            fileData: slicedFileData(from: timeline.fileData, for: thread.replies.flatMap(\.files)),
                                            avatarData: timeline.avatarData,
                                            customEmojiData: slicedEmojiData(from: timeline.customEmojiData, reactions: thread.replies.flatMap(\.reactions)),
                                            messageFontSize: messageFontSize,
                                            fontFamily: selectedFontFamily,
                                            mediaClient: timeline.mediaClient,
                                            onStartDirectMessage: onStartDirectMessage,
                                            onReply: onReply,
                                            onEdit: timeline.beginEditing,
                                            onDelete: timeline.delete,
                                            onVote: onVote,
                                            onEndPoll: timeline.endPoll,
                                            onContentVisible: timeline.loadVisibleContent,
                                            onReactionTooltipChange: updateReactionTooltip
                                        ) { post, emojiName in
                                            timeline.toggleReaction(on: post, emojiName: emojiName)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.vertical, 10)
                    .frame(minHeight: geometry.size.height, alignment: .bottom)
                }
                .defaultScrollAnchor(.bottom)
                .overlayPreferenceValue(ReactionTooltipAnchorKey.self) { anchors in
                    GeometryReader { proxy in
                        if let reactionTooltip, let anchor = anchors[reactionTooltip.id] {
                            ReactionTooltipView(text: reactionTooltip.text)
                                .position(
                                    x: proxy[anchor].midX,
                                    y: proxy[anchor].maxY + 18
                                )
                                .allowsHitTesting(false)
                        }
                    }
                }
                .onChange(of: newestRootPostID) { _, postID in
                    guard focusedPostID == nil else { return }
                    scrollToLatest(postID, with: proxy)
                }
                .task(id: channelID) {
                    await timeline.load(channelID: channelID, aroundPostID: focusedPostID)
                    if let focusedPostID {
                        scrollTo(focusedPostID, with: proxy)
                        onFocusedPostDisplayed(focusedPostID)
                    } else {
                        scrollToLatest(newestRootPostID, with: proxy)
                    }
                }
            }
            .task(id: timeline.posts) {
                let interval = AppLogger.timeline.beginInterval("Regroup Timeline Posts")
                items = await Self.makeItems(from: timeline.posts)
                AppLogger.timeline.endInterval("Regroup Timeline Posts", interval)
            }
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.width
            } action: { width in
                AppLogger.timeline.emitEvent("Timeline Width Changed", "width: \(width)")
            }
        }
        .accessibilityLabel("Message timeline")
        .accessibilityIdentifier("message-timeline")
    }

    /// Flattens threads into one lazy child per header or thread. Keeping each
    /// item bounded is what lets LazyVStack materialize only rows near the
    /// viewport; day-sized groups forced whole-day row measurement whenever a
    /// day entered the prefetch window, stalling the main thread for seconds.
    /// ponytail: a thread with a very large reply count still measures in one
    /// burst; if that ever bites, split replies into their own items.
    private static func makeItems(from posts: [MattermostPost]) async -> [TimelineItem] {
        await Task.detached(priority: .userInitiated) {
            let byDay = Dictionary(grouping: MattermostTimelineThreading.threads(from: posts)) { thread in
                Calendar.current.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(thread.root.createAt) / 1_000))
            }
            var items: [TimelineItem] = []
            for day in byDay.sorted(by: { $0.key < $1.key }) {
                items.append(.header(day.key))
                let threads = day.value
                for index in threads.indices {
                    items.append(.thread(threads[index], previousRoot: index > 0 ? threads[index - 1].root : nil))
                }
            }
            return items
        }.value
    }

    private var newestRootPostID: String? {
        timeline.posts.last(where: \.rootID.isEmpty)?.id
    }

    private var messageUsers: [String: MattermostUser] {
        knownUsers.merging(timeline.users) { _, timelineUser in timelineUser }
    }

    private var messageStatuses: [String: String] {
        statuses.merging(timeline.statuses) { _, timelineStatus in timelineStatus }
    }

    private var selectedFontFamily: AppFontFamily {
        AppFontFamily(rawValue: appFontFamily) ?? .system
    }

    private var messageGrouping: MattermostTimelineGrouping {
        MattermostTimelineGrouping(maximumInterval: messageGroupingIntervalMinutes * 60)
    }

    private func messageRow(for post: MattermostPost, previousRoot: MattermostPost?) -> some View {
        MessageRow(
            post: post,
            users: slicedUsers(from: messageUsers, userIDs: postUserIDs(post)),
            avatarData: timeline.avatarData[post.userID],
            fileData: slicedFileData(from: timeline.fileData, for: post.files),
            customEmojiData: slicedEmojiData(from: timeline.customEmojiData, reactions: post.reactions),
            status: timeline.statuses[post.userID] ?? statuses[post.userID],
            messageFontSize: messageFontSize,
            fontFamily: selectedFontFamily,
            currentUserID: currentUserID,
            currentUsername: currentUsername,
            mediaClient: timeline.mediaClient,
            showsMetadata: !messageGrouping.shouldGroup(post, with: previousRoot),
            horizontalInset: 18,
            onStartDirectMessage: onStartDirectMessage,
            onReply: onReply,
            onOpenThread: onOpenThread,
            onEdit: timeline.beginEditing,
            onDelete: timeline.delete,
            onVote: onVote,
            onEndPoll: timeline.endPoll,
            onContentVisible: timeline.loadVisibleContent,
            onReactionTooltipChange: updateReactionTooltip,
            onToggleReaction: { post, emojiName in
                timeline.toggleReaction(on: post, emojiName: emojiName)
            }
        )
        .equatable()
    }

    private func updateReactionTooltip(_ tooltip: ReactionTooltip?) {
        reactionTooltip = tooltip
    }

    private func scrollToLatest(_ postID: String?, with proxy: ScrollViewProxy) {
        guard let postID else { return }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(postID, anchor: .bottom)
            }
        }
    }

    private func scrollTo(_ postID: String, with proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(postID, anchor: .center)
            }
        }
    }
}

struct ReactionTooltip: Identifiable {
    let id: String
    let text: String
}

private struct ReactionTooltipAnchorKey: PreferenceKey {
    static let defaultValue: [String: Anchor<CGRect>] = [:]

    static func reduce(value: inout [String: Anchor<CGRect>], nextValue: () -> [String: Anchor<CGRect>]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct ReactionTooltipView: View {
    let text: String

    var body: some View {
        Text(text)
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
    }
}

/// A single lazy child of the timeline list: either a day header or one
/// thread (its root plus inline replies). Flat per-thread granularity keeps
/// LazyVStack materialization bounded to rows near the viewport instead of
/// materializing an entire day whenever it enters the prefetch window.
private enum TimelineItem: Identifiable {
    case header(Date)
    case thread(MattermostTimelineThread, previousRoot: MattermostPost?)

    var id: String {
        switch self {
        case .header(let date): return "day-\(date.timeIntervalSince1970)"
        case .thread(let thread, _): return thread.id
        }
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

struct MessageRow: View {
    let post: MattermostPost
    let users: [String: MattermostUser]
    let avatarData: Data?
    let fileData: [String: Data]
    let customEmojiData: [String: Data]
    let status: String?
    let messageFontSize: Double
    let fontFamily: AppFontFamily
    let currentUserID: String?
    let currentUsername: String?
    let mediaClient: MattermostAPIClient
    let showsMetadata: Bool
    let horizontalInset: CGFloat
    let onStartDirectMessage: (MattermostUser) -> Void
    let onReply: (MattermostPost) -> Void
    let onOpenThread: (MattermostPost) -> Void
    let onEdit: (MattermostPost) -> Void
    let onDelete: (MattermostPost) -> Void
    let onVote: (MattermostPost, String) -> Void
    let onEndPoll: (MattermostPost) -> Void
    let onContentVisible: ([MattermostPost]) async -> Void
    let onReactionTooltipChange: (ReactionTooltip?) -> Void
    let onToggleReaction: (MattermostPost, String) -> Void
    @EnvironmentObject private var userColorSettings: UserColorSettings
    @AppStorage("showTimelineAvatars") private var showAvatars = true
    @State private var isHovering = false
    @State private var isReactionPickerPresented = false
    @State private var isDeleteConfirmationPresented = false

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

            if showsMetadata {
                if let authorUser {
                    UserProfileButton(
                        user: authorUser,
                        avatarData: avatarData,
                        onStartDirectMessage: onStartDirectMessage
                    )
                    .frame(width: 112, alignment: .leading)
                    .padding(.top, 4)
                } else {
                    HStack(spacing: 4) {
                        Text(author)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(userColorSettings.color(for: post.userID))
                            .lineLimit(1)
                        if post.overrideUsername != nil {
                            Text("BOT")
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                                .foregroundStyle(WorkspaceTheme.secondaryText)
                                .padding(.horizontal, 3)
                                .padding(.vertical, 1)
                                .background(WorkspaceTheme.raisedSurface, in: Capsule())
                                .accessibilityLabel("Bot")
                        }
                    }
                    .frame(width: 112, alignment: .leading)
                    .padding(.top, 4)
                }

                Text(timestamp)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .frame(width: 50, alignment: .trailing)
                    .padding(.top, 4)
            } else {
                Color.clear.frame(width: 112, height: 1)
                Color.clear.frame(width: 50, height: 1)
            }

            VStack(alignment: .leading, spacing: 6) {
                RichMessageContent(
                    post: post,
                    fontSize: messageFontSize,
                    fontFamily: fontFamily,
                    currentUsername: currentUsername,
                    fileData: fileData,
                    mediaClient: mediaClient,
                    loadContent: { await onContentVisible([post]) }
                )
                .equatable()
                if let poll = post.poll {
                    SocialPoll(
                        poll: poll,
                        canEnd: post.userID == currentUserID,
                        vote: { actionID in onVote(post, actionID) },
                        end: { onEndPoll(post) }
                    )
                }
                ReactionSummary(
                    post: post,
                    displayName: { userID in users[userID]?.displayName ?? "Unknown member" },
                    currentUserID: currentUserID,
                    customEmojiData: customEmojiData,
                    onToggleReaction: onToggleReaction,
                    onTooltipChange: onReactionTooltipChange,
                    showsTooltips: true,
                    allowsInteraction: true
                )
                .equatable()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .topTrailing) {
                if isHovering || isReactionPickerPresented {
                    MessageActionBar(
                        post: post,
                        currentUserID: currentUserID,
                        isReactionPickerPresented: $isReactionPickerPresented,
                        onReply: onReply,
                        onOpenThread: onOpenThread,
                        onEdit: onEdit,
                        onDelete: { isDeleteConfirmationPresented = true },
                        onToggleReaction: onToggleReaction
                    )
                }
            }
        }
        .padding(.horizontal, horizontalInset)
        .padding(.vertical, 3)
        .background(isHovering ? WorkspaceTheme.hoverSurface : .clear)
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .contextMenu {
            Button("Reply") { onReply(post) }
            Button("Copy message") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(post.message, forType: .string)
            }
            Divider()
            if post.userID == currentUserID {
                Button("Edit message") {
                    onEdit(post)
                }
                Button("Delete message", role: .destructive) {
                    isDeleteConfirmationPresented = true
                }
            }
        }
        .alert("Delete this message?", isPresented: $isDeleteConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { onDelete(post) }
        } message: {
            Text("This cannot be undone.")
        }
    }

    private var author: String {
        post.overrideUsername ?? users[post.userID]?.displayName ?? "Unknown member"
    }

    private var authorUser: MattermostUser? {
        post.overrideUsername == nil ? users[post.userID] : nil
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
    let canEnd: Bool
    let vote: (String) -> Void
    let end: () -> Void
    @State private var selectedActionID: String?
    @State private var isEndConfirmationPresented = false

    private var options: [MattermostPollAction] {
        poll.attachment?.actions.filter(\.isVote) ?? []
    }

    private var totalVotes: Int {
        options.reduce(0) { $0 + $1.voteCount }
    }

    /// Matterpoll omits counts unless the poll was created with `--progress`.
    /// Treat omitted counts as unavailable, not as zero votes.
    private var hasVoteCounts: Bool {
        options.contains { $0.name.range(of: #" \([0-9]+\)$"#, options: .regularExpression) != nil }
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
                    selectedActionID = option.id
                    vote(option.id)
                } label: {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 10)
                                .fill(isSelected(option) ? WorkspaceTheme.navigationAccent.opacity(0.18) : WorkspaceTheme.primaryText.opacity(0.06))
                                .frame(width: geometry.size.width * percentage(for: option))
                            HStack(spacing: 6) {
                                Text(option.option)
                                    .font(.system(size: 14, weight: isSelected(option) ? .semibold : .regular))
                                    .foregroundStyle(WorkspaceTheme.primaryText)
                                if isSelected(option) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 13))
                                        .foregroundStyle(WorkspaceTheme.navigationAccent)
                                }
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
            Text(voteSummary)
                .font(.system(size: 12))
                .foregroundStyle(WorkspaceTheme.secondaryText)
            if canEnd {
                Button("End poll") {
                    isEndConfirmationPresented = true
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.attention)
            }
        }
        .padding(16)
        .frame(maxWidth: 300, alignment: .leading)
        .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(WorkspaceTheme.primaryText.opacity(0.06), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.05), radius: 14, x: 0, y: 6)
        .alert("End this poll?", isPresented: $isEndConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("End poll", role: .destructive, action: end)
        } message: {
            Text("Voting will close and the final results will be posted.")
        }
    }

    private func percentage(for option: MattermostPollAction) -> CGFloat {
        guard hasVoteCounts, totalVotes > 0 else { return isSelected(option) ? 1 : 0 }
        return CGFloat(option.voteCount) / CGFloat(totalVotes)
    }

    private func isSelected(_ option: MattermostPollAction) -> Bool {
        selectedActionID == option.id
    }

    private var voteSummary: String {
        guard hasVoteCounts else {
            return selectedActionID == nil ? "Results are hidden until the poll ends." : "Your vote was recorded. Results are hidden until the poll ends."
        }
        return "\(totalVotes) \(totalVotes == 1 ? "vote" : "votes")"
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
    let customEmojiData: [String: Data]
    let messageFontSize: Double
    let fontFamily: AppFontFamily
    let mediaClient: MattermostAPIClient
    let onStartDirectMessage: (MattermostUser) -> Void
    let onReply: (MattermostPost) -> Void
    let onEdit: (MattermostPost) -> Void
    let onDelete: (MattermostPost) -> Void
    let onVote: (MattermostPost, String) -> Void
    let onEndPoll: (MattermostPost) -> Void
    let onContentVisible: ([MattermostPost]) async -> Void
    let onReactionTooltipChange: (ReactionTooltip?) -> Void
    let onToggleReaction: (MattermostPost, String) -> Void
    @AppStorage("showTimelineAvatars") private var showAvatars = true
    @State private var showsAllReplies = false

    var body: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(WorkspaceTheme.divider)
                .frame(width: 2)

            // A plain VStack, not LazyVStack: the outer timeline stack already places
            // thread groups lazily, and a nested lazy container re-runs its placement
            // machinery on every outer pass for what is only a handful of replies.
            VStack(alignment: .leading, spacing: 8) {
                ForEach(visibleReplies) { reply in
                    InlineReplyRow(
                        post: reply,
                        users: users,
                        status: statuses[reply.userID],
                        currentUserID: currentUserID,
                        currentUsername: currentUsername,
                        fileData: fileData,
                        avatarData: avatarData[reply.userID],
                        customEmojiData: customEmojiData,
                        messageFontSize: messageFontSize,
                        fontFamily: fontFamily,
                        mediaClient: mediaClient,
                        onStartDirectMessage: onStartDirectMessage,
                        onReply: onReply,
                        onEdit: onEdit,
                        onDelete: onDelete,
                        onVote: onVote,
                        onEndPoll: onEndPoll,
                        onContentVisible: onContentVisible,
                        onReactionTooltipChange: onReactionTooltipChange,
                        onToggleReaction: onToggleReaction
                    )
                    .equatable()
                    .id(reply.id)
                }

                if replies.count > visibleReplies.count {
                    Button("Load \(replies.count - visibleReplies.count) more replies") {
                        showsAllReplies = true
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.accent)
                }
            }
            .padding(10)
        }
        .background(WorkspaceTheme.raisedSurface)
        .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))
        .padding(.leading, replyLeadingInset)
        .padding(.trailing, 18)
        .padding(.vertical, 5)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(replies.count) inline replies")
    }

    private var visibleReplies: ArraySlice<MattermostPost> {
        showsAllReplies ? replies[...] : replies.prefix(2)
    }

    private var replyLeadingInset: CGFloat {
        let avatarWidth: CGFloat = showAvatars ? 22 : 0
        let gapCount: CGFloat = showAvatars ? 4 : 3
        let messageContentLeadingInset = 18 + 5 + avatarWidth + 112 + 50 + gapCount * 10
        // The thread divider and its inner padding occupy 12 points before
        // the reply content; indent the thread content an additional 24 points.
        return messageContentLeadingInset - 12 + 24
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
    let customEmojiData: [String: Data]
    let messageFontSize: Double
    let fontFamily: AppFontFamily
    let mediaClient: MattermostAPIClient
    let onStartDirectMessage: (MattermostUser) -> Void
    let onReply: (MattermostPost) -> Void
    let onEdit: (MattermostPost) -> Void
    let onDelete: (MattermostPost) -> Void
    let onVote: (MattermostPost, String) -> Void
    let onEndPoll: (MattermostPost) -> Void
    let onContentVisible: ([MattermostPost]) async -> Void
    let onReactionTooltipChange: (ReactionTooltip?) -> Void
    let onToggleReaction: (MattermostPost, String) -> Void
    @EnvironmentObject private var userColorSettings: UserColorSettings
    @State private var isHovering = false
    @State private var isReactionPickerPresented = false
    @State private var isDeleteConfirmationPresented = false

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
                    HStack(spacing: 4) {
                        Text(author)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(userColorSettings.color(for: post.userID))
                        if post.overrideUsername != nil {
                            Text("BOT")
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                                .foregroundStyle(WorkspaceTheme.secondaryText)
                                .padding(.horizontal, 3)
                                .padding(.vertical, 1)
                                .background(WorkspaceTheme.raisedSurface, in: Capsule())
                                .accessibilityLabel("Bot")
                        }
                    }
                }
                Text(timestamp)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }

            RichMessageContent(
                post: post,
                fontSize: messageFontSize,
                fontFamily: fontFamily,
                currentUsername: currentUsername,
                fileData: fileData,
                mediaClient: mediaClient,
                loadContent: { await onContentVisible([post]) }
            )
            .equatable()
            if let poll = post.poll {
                SocialPoll(
                    poll: poll,
                    canEnd: post.userID == currentUserID,
                    vote: { actionID in onVote(post, actionID) },
                    end: { onEndPoll(post) }
                )
            }
            ReactionSummary(
                post: post,
                displayName: { userID in users[userID]?.displayName ?? "Unknown member" },
                currentUserID: currentUserID,
                customEmojiData: customEmojiData,
                onToggleReaction: onToggleReaction,
                onTooltipChange: onReactionTooltipChange,
                showsTooltips: true,
                allowsInteraction: true
            )
            .equatable()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .topTrailing) {
            if isHovering || isReactionPickerPresented {
                MessageActionBar(
                    post: post,
                    currentUserID: currentUserID,
                    isReactionPickerPresented: $isReactionPickerPresented,
                    onReply: onReply,
                    onOpenThread: { _ in },
                    onEdit: onEdit,
                    onDelete: { isDeleteConfirmationPresented = true },
                    onToggleReaction: onToggleReaction
                )
            }
        }
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(author), \(timestamp), \(post.message)")
        .contextMenu {
            Button("Reply") { onReply(post) }
            Button("Copy message") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(post.message, forType: .string)
            }
            Divider()
            if post.userID == currentUserID {
                Button("Edit message") {
                    onEdit(post)
                }
                Button("Delete message", role: .destructive) {
                    isDeleteConfirmationPresented = true
                }
            }
        }
        .alert("Delete this message?", isPresented: $isDeleteConfirmationPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { onDelete(post) }
        } message: {
            Text("This cannot be undone.")
        }
    }

    private var author: String {
        post.overrideUsername ?? users[post.userID]?.displayName ?? "Unknown member"
    }

    private var authorUser: MattermostUser? {
        post.overrideUsername == nil ? users[post.userID] : nil
    }

    private var timestamp: String {
        Date(timeIntervalSince1970: TimeInterval(post.createAt) / 1_000)
            .formatted(date: .omitted, time: .shortened)
    }
}

private struct MessageActionBar: View {
    let post: MattermostPost
    let currentUserID: String?
    @Binding var isReactionPickerPresented: Bool
    let onReply: (MattermostPost) -> Void
    let onOpenThread: (MattermostPost) -> Void
    let onEdit: (MattermostPost) -> Void
    let onDelete: () -> Void
    let onToggleReaction: (MattermostPost, String) -> Void

    var body: some View {
        HStack(spacing: 2) {
            AddReactionButton(
                post: post,
                isPickerPresented: $isReactionPickerPresented,
                onToggleReaction: onToggleReaction
            )
            actionButton("arrowshape.turn.up.left", label: "Reply") { onReply(post) }
            if post.userID == currentUserID {
                actionButton("pencil", label: "Edit message") { onEdit(post) }
            }
            Menu {
                Button("Open thread") { onOpenThread(post) }
                Button("Copy message") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(post.message, forType: .string)
                }
                if post.userID == currentUserID {
                    Button("Delete message", role: .destructive, action: onDelete)
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

    private func actionButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .medium))
                .frame(width: 26, height: 26)
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
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
    let customEmojiData: [String: Data]
    let onToggleReaction: (MattermostPost, String) -> Void
    let onTooltipChange: (ReactionTooltip?) -> Void
    let showsTooltips: Bool
    let allowsInteraction: Bool

    var body: some View {
        HStack(spacing: 5) {
            ForEach(summaries) { summary in
                if showsTooltips {
                    Button {
                        onToggleReaction(post, summary.emojiName)
                    } label: {
                        reactionBadge(summary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        "\(summary.emojiName) reaction, \(summary.count)\(summary.userIDs.contains(currentUserID ?? "") ? ", selected" : "")"
                    )
                    .anchorPreference(key: ReactionTooltipAnchorKey.self, value: .bounds) {
                        [summary.id: $0]
                    }
                    .onHover { isHovering in
                        onTooltipChange(
                            isHovering
                                ? ReactionTooltip(
                                    id: summary.id,
                                    text: "\(readableName(for: summary.emojiName)) · \(summary.userIDs.map(displayName).joined(separator: ", "))"
                                )
                                : nil
                        )
                    }
                } else if allowsInteraction {
                    Button {
                        onToggleReaction(post, summary.emojiName)
                    } label: {
                        reactionBadge(summary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        "\(summary.emojiName) reaction, \(summary.count)\(summary.userIDs.contains(currentUserID ?? "") ? ", selected" : "")"
                    )
                } else {
                    reactionBadge(summary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func reactionBadge(_ summary: ReactionCount) -> some View {
        HStack(spacing: 3) {
            if let data = customEmojiData[summary.emojiName],
               let image = NSImage(data: data) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 14, height: 14)
            } else {
                Text(displayEmoji(for: summary.emojiName))
                    .font(.system(size: 14))
            }
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

    private var summaries: [ReactionCount] {
        Dictionary(grouping: post.reactions, by: \.emojiName)
            .map {
                ReactionCount(
                    postID: post.id,
                    emojiName: $0.key,
                    userIDs: $0.value.map(\.userID)
                )
            }
            .sorted { $0.emojiName < $1.emojiName }
    }

    private func displayEmoji(for emojiName: String) -> String {
        EmojiData.emoji(fromShortName: emojiName)?.character ?? emojiName
    }

    private func readableName(for emojiName: String) -> String {
        emojiName.replacingOccurrences(of: "_", with: " ").capitalized
    }

}

private struct AddReactionButton: View {
    let post: MattermostPost
    @Binding var isPickerPresented: Bool
    let onToggleReaction: (MattermostPost, String) -> Void
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
            guard let emojiName = EmojiData.emoji(fromCharacter: emoji)?.shortName else { return }
            onToggleReaction(post, emojiName)
            selectedEmoji = ""
            isPickerPresented = false
        }
        .accessibilityLabel("Add reaction")
    }
}

private struct ReactionCount: Identifiable {
    let postID: String
    let emojiName: String
    let userIDs: [String]

    var id: String { "\(postID):\(emojiName)" }
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

// ponytail:perf — hand-written equality so SwiftUI can skip re-rendering a row whose
// display inputs did not change (closures and the shared media client are stable for
// the lifetime of a timeline session and are intentionally excluded). This is the main
// lever that keeps a full-timeline publish from re-evaluating every visible row.
extension MessageRow: Equatable {
    nonisolated static func == (lhs: MessageRow, rhs: MessageRow) -> Bool {
        lhs.post == rhs.post
            && lhs.users == rhs.users
            && lhs.avatarData == rhs.avatarData
            && lhs.fileData == rhs.fileData
            && lhs.customEmojiData == rhs.customEmojiData
            && lhs.status == rhs.status
            && lhs.messageFontSize == rhs.messageFontSize
            && lhs.fontFamily == rhs.fontFamily
            && lhs.currentUserID == rhs.currentUserID
            && lhs.currentUsername == rhs.currentUsername
            && lhs.showsMetadata == rhs.showsMetadata
            && lhs.horizontalInset == rhs.horizontalInset
    }
}

extension InlineReplyRow: Equatable {
    nonisolated static func == (lhs: InlineReplyRow, rhs: InlineReplyRow) -> Bool {
        lhs.post == rhs.post
            && lhs.users == rhs.users
            && lhs.status == rhs.status
            && lhs.currentUserID == rhs.currentUserID
            && lhs.currentUsername == rhs.currentUsername
            && lhs.fileData == rhs.fileData
            && lhs.avatarData == rhs.avatarData
            && lhs.customEmojiData == rhs.customEmojiData
            && lhs.messageFontSize == rhs.messageFontSize
            && lhs.fontFamily == rhs.fontFamily
    }
}

extension ReactionSummary: Equatable {
    nonisolated static func == (lhs: ReactionSummary, rhs: ReactionSummary) -> Bool {
        lhs.post == rhs.post
            && lhs.currentUserID == rhs.currentUserID
            && lhs.customEmojiData == rhs.customEmojiData
            && lhs.showsTooltips == rhs.showsTooltips
            && lhs.allowsInteraction == rhs.allowsInteraction
    }
}
