import AntimatterFoundation
import AppKit
import SwiftUI

struct MessageTimeline: View {
    @ObservedObject var timeline: TimelineViewModel
    let knownUsers: [String: MattermostUser]
    let statuses: [String: String]
    let channelID: String?
    let onReply: (MattermostPost) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if timeline.isLoading && timeline.posts.isEmpty {
                        ProgressView()
                            .controlSize(.small)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 28)
                    } else if let error = timeline.loadError {
                        TimelineStatus(message: error, isError: true)
                    } else if timeline.posts.isEmpty {
                        TimelineStatus(message: "No messages in this conversation yet.", isError: false)
                    } else {
                        ForEach(groups) { group in
                            TimelineDateHeader(date: group.date)
                            ForEach(group.posts) { post in
                                MessageRow(
                                    post: post,
                                    user: timeline.users[post.userID] ?? knownUsers[post.userID],
                                    avatarData: timeline.avatarData[post.userID],
                                    status: timeline.statuses[post.userID] ?? statuses[post.userID],
                                    onReply: onReply,
                                    onEdit: timeline.beginEditing
                                ) { post, emojiName in
                                    timeline.toggleReaction(on: post, emojiName: emojiName)
                                }
                                    .id(post.id)
                            }
                        }
                    }
                }
                .padding(.vertical, 14)
            }
            .onChange(of: newestPostID) { _, postID in
                scrollToLatest(postID, with: proxy)
            }
            .task(id: channelID) {
                await timeline.load(channelID: channelID)
                scrollToLatest(newestPostID, with: proxy)
            }
        }
        .accessibilityLabel("Message timeline")
        .accessibilityIdentifier("message-timeline")
    }

    private var groups: [TimelineGroup] {
        Dictionary(grouping: timeline.posts) { post in
            Calendar.current.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(post.createAt) / 1_000))
        }
        .map { TimelineGroup(date: $0.key, posts: $0.value) }
        .sorted { $0.date < $1.date }
    }

    private var newestPostID: String? {
        timeline.posts.last?.id
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
    let posts: [MattermostPost]

    var id: Date { date }
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
    let user: MattermostUser?
    let avatarData: Data?
    let status: String?
    let onReply: (MattermostPost) -> Void
    let onEdit: (MattermostPost) -> Void
    let onToggleReaction: (MattermostPost, String) -> Void
    @AppStorage("showTimelineAvatars") private var showAvatars = true
    @AppStorage("messageFontSize") private var messageFontSize = 12.0
    @State private var isHovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            PresenceDot(status: status)
                .padding(.top, 8)

            if showAvatars {
                Avatar(data: avatarData, initials: initials)
                    .accessibilityHidden(true)
            }

            Text(author)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.primaryText)
                .frame(width: 112, alignment: .leading)
                .padding(.top, 4)

            Text(timestamp)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .frame(width: 44, alignment: .trailing)
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 6) {
                RichMessageContent(post: post, fontSize: messageFontSize)
                ReactionSummary(post: post, onToggleReaction: onToggleReaction)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .topTrailing) {
                if isHovering {
                    AddReactionButton(post: post, onToggleReaction: onToggleReaction)
                        .background(WorkspaceTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 6)
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
            Button("Edit message") {
                onEdit(post)
            }
        }
    }

    private var author: String {
        user?.displayName ?? user?.username ?? "Unknown member"
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
    let onToggleReaction: (MattermostPost, String) -> Void

    var body: some View {
        HStack(spacing: 5) {
            ForEach(summaries) { summary in
                Button {
                    onToggleReaction(post, summary.emojiName)
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: symbol(for: summary.emojiName))
                            .font(.system(size: 11, weight: .semibold))
                        Text("\(summary.count)")
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    }
                    .foregroundStyle(WorkspaceTheme.primaryText)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(WorkspaceTheme.raisedSurface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(WorkspaceTheme.divider, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(summary.emojiName) reaction, \(summary.count)")
            }

        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var summaries: [ReactionCount] {
        Dictionary(grouping: post.reactions, by: \.emojiName)
            .map { ReactionCount(emojiName: $0.key, count: $0.value.count) }
            .sorted { $0.emojiName < $1.emojiName }
    }

    private func symbol(for emojiName: String) -> String {
        switch emojiName {
        case "heart": "heart.fill"
        case "+1", "thumbsup": "hand.thumbsup.fill"
        case "-1", "thumbsdown": "hand.thumbsdown.fill"
        case "tada": "sparkles"
        default: "face.smiling"
        }
    }

}

private struct AddReactionButton: View {
    let post: MattermostPost
    let onToggleReaction: (MattermostPost, String) -> Void
    @State private var isPickerPresented = false

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
            ReactionPicker { emojiName in
                onToggleReaction(post, emojiName)
                isPickerPresented = false
            }
            .padding(10)
        }
        .accessibilityLabel("Add reaction")
    }
}

private struct ReactionPicker: View {
    let onSelect: (String) -> Void
    private let emojiNames = ["+1", "heart", "joy", "tada", "rocket", "eyes", "fire", "white_check_mark", "thinking_face", "wave"]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(28)), count: 5), spacing: 6) {
            ForEach(emojiNames, id: \.self) { emojiName in
                Button {
                    onSelect(emojiName)
                } label: {
                    Text(symbol(for: emojiName))
                        .font(.system(size: 17))
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(emojiName)
            }
        }
        .frame(width: 164)
    }

    private func symbol(for emojiName: String) -> String {
        switch emojiName {
        case "+1": "👍"
        case "heart": "❤️"
        case "joy": "😂"
        case "tada": "🎉"
        case "rocket": "🚀"
        case "eyes": "👀"
        case "fire": "🔥"
        case "white_check_mark": "✅"
        case "thinking_face": "🤔"
        default: "👋"
        }
    }
}

private struct ReactionCount: Identifiable {
    let emojiName: String
    let count: Int

    var id: String { emojiName }
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
