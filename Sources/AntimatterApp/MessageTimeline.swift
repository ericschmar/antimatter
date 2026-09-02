import AntimatterFoundation
import SwiftUI

struct MessageTimeline: View {
    @ObservedObject var timeline: TimelineViewModel
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
                                MessageRow(post: post, onReply: onReply) { post, emojiName in
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
    let onReply: (MattermostPost) -> Void
    let onToggleReaction: (MattermostPost, String) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(WorkspaceTheme.raisedSurface)
                .frame(width: 22, height: 22)
                .overlay {
                    Text(initials)
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                }
                .accessibilityHidden(true)

            Text(author)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.primaryText)
                .frame(width: 92, alignment: .leading)

            VStack(alignment: .leading, spacing: 6) {
                RichMessageContent(post: post)
                ReactionSummary(post: post, onToggleReaction: onToggleReaction)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(timestamp)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .frame(width: 44, alignment: .trailing)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(author), \(timestamp), \(post.message)")
        .contextMenu {
            Button("Reply") { onReply(post) }
        }
    }

    private var author: String {
        "Member \(post.userID.prefix(6))"
    }

    private var initials: String {
        String(post.userID.prefix(2)).uppercased()
    }

    private var timestamp: String {
        Date(timeIntervalSince1970: TimeInterval(post.createAt) / 1_000)
            .formatted(date: .omitted, time: .shortened)
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

            Menu {
                ForEach(Self.supportedEmojiNames, id: \.self) { emojiName in
                    Button(emojiName) {
                        onToggleReaction(post, emojiName)
                    }
                }
            } label: {
                Image(systemName: "face.smiling")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .padding(5)
            }
            .menuStyle(.borderlessButton)
            .accessibilityLabel("Add reaction")
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

    private static let supportedEmojiNames = ["heart", "+1", "-1", "tada"]
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
