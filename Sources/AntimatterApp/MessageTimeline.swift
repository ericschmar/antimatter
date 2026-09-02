import AntimatterFoundation
import SwiftUI

struct MessageTimeline: View {
    @ObservedObject var timeline: TimelineViewModel
    let channelID: String?

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
                                MessageRow(post: post)
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

            Text(post.message)
                .font(.system(size: 13))
                .foregroundStyle(WorkspaceTheme.primaryText)
                .textSelection(.enabled)
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
