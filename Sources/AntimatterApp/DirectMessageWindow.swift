import AntimatterFoundation
import SwiftUI

enum DirectMessagePresentation: Equatable {
    case workspace
    case window

    init(automaticallyOpenInNewWindow: Bool) {
        self = automaticallyOpenInNewWindow ? .window : .workspace
    }

    static var current: Self {
        Self(automaticallyOpenInNewWindow: AppConfiguration.automaticallyOpenDirectMessagesInNewWindow)
    }

    var selectsInWorkspace: Bool {
        self == .workspace
    }
}

struct DirectMessageWindowRoute: Codable, Hashable {
    let serverURL: String
    let channelID: String
    let title: String

    init(session: MattermostSession, channel: MattermostChannel, title: String) {
        serverURL = session.serverURL.absoluteString
        channelID = channel.id
        self.title = title
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.serverURL == rhs.serverURL && lhs.channelID == rhs.channelID
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(serverURL)
        hasher.combine(channelID)
    }
}

@MainActor
final class DirectMessageWindowRegistry: ObservableObject {
    private var openRoutes = Set<DirectMessageWindowRoute>()

    func claim(_ route: DirectMessageWindowRoute) -> Bool {
        openRoutes.insert(route).inserted
    }

    func release(_ route: DirectMessageWindowRoute) {
        openRoutes.remove(route)
    }
}

@MainActor
@discardableResult
func requestDirectMessageWindow(
    for channel: MattermostChannel,
    session: MattermostSession,
    title: String,
    presentation: DirectMessagePresentation,
    registry: DirectMessageWindowRegistry,
    openWindow: (DirectMessageWindowRoute) -> Void
) -> Bool {
    guard presentation == .window, channel.type == "D" else { return false }
    let route = DirectMessageWindowRoute(session: session, channel: channel, title: title)
    guard registry.claim(route) else { return false }
    openWindow(route)
    return true
}

struct DirectMessageWindow: View {
    let route: DirectMessageWindowRoute
    let configuration: AppConfiguration
    let session: MattermostSession
    @EnvironmentObject private var registry: DirectMessageWindowRegistry
    @Environment(\.openWindow) private var openWindow
    @StateObject private var navigation: NavigationViewModel
    @StateObject private var timeline: TimelineViewModel
    @StateObject private var composer: ComposerViewModel
    @StateObject private var channelFiles: ChannelFilesViewModel
    @StateObject private var presence: PresenceViewModel
    @StateObject private var realtime: RealtimeUpdatesViewModel
    @State private var isChannelFilesPresented = false
    @State private var selectedThreadRootID: String?

    init(
        route: DirectMessageWindowRoute,
        configuration: AppConfiguration,
        session: MattermostSession,
        navigation: NavigationViewModel? = nil
    ) {
        self.route = route
        self.configuration = configuration
        self.session = session
        _navigation = StateObject(wrappedValue: navigation ?? NavigationViewModel(session: session))
        _timeline = StateObject(wrappedValue: TimelineViewModel(session: session))
        _composer = StateObject(wrappedValue: ComposerViewModel(session: session, giphyAPIKey: configuration.giphyAPIKey))
        _channelFiles = StateObject(wrappedValue: ChannelFilesViewModel(session: session))
        _presence = StateObject(wrappedValue: PresenceViewModel(session: session))
        _realtime = StateObject(wrappedValue: RealtimeUpdatesViewModel(session: session))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(route.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)

                Spacer(minLength: 0)

                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isChannelFilesPresented.toggle()
                        if isChannelFilesPresented {
                            selectedThreadRootID = nil
                            channelFiles.load(channelID: route.channelID)
                        }
                    }
                } label: {
                    Image(systemName: "folder")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 28, height: 28)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(isChannelFilesPresented ? WorkspaceTheme.accent : WorkspaceTheme.secondaryText)
                .accessibilityLabel(isChannelFilesPresented ? "Close channel files" : "Show channel files")
                .accessibilityHint("Shows files shared in this direct message.")
            }
            .padding(.leading, WorkspaceTheme.titleBarControlInset + 4)
            .padding(.trailing, 18)
            .frame(height: WorkspaceTheme.titleBarContentHeight)
            .background(WorkspaceTheme.surface)
            .background(WindowDragConfiguration())

            Divider().overlay(WorkspaceTheme.divider)

            GeometryReader { geometry in
                HStack(spacing: 0) {
                    VStack(spacing: 0) {
                        MessageTimeline(
                            timeline: timeline,
                            knownUsers: navigation.users,
                            statuses: presence.statuses,
                            currentUserID: navigation.currentUserID,
                            currentUsername: navigation.currentUserID.flatMap { navigation.users[$0]?.username },
                            channelID: route.channelID,
                            focusedPostID: nil,
                            onStartDirectMessage: startDirectMessage,
                            onReply: composer.reply,
                            onOpenThread: openThread,
                            onVote: { post, actionID in
                                timeline.vote(on: post, actionID: actionID)
                            },
                            onFocusedPostDisplayed: { _ in }
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .overlay(alignment: .bottomLeading) {
                            if !typingNames.isEmpty {
                                ChatTypingIndicator(names: typingNames)
                                    .padding(.leading, 18)
                                    .padding(.bottom, 6)
                            }
                        }

                        if selectedThreadRootID == nil {
                            Divider().overlay(WorkspaceTheme.divider)
                            messageComposer
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .allowsHitTesting(selectedThreadRootID == nil && !isChannelFilesPresented)
                .blur(radius: selectedThreadRootID == nil && !isChannelFilesPresented ? 0 : 3)
                .overlay(alignment: .trailing) {
                    if let selectedThreadRootID {
                        VStack(spacing: 0) {
                            ThreadSidebar(
                                timeline: timeline,
                                rootID: selectedThreadRootID,
                                users: navigation.users.merging(timeline.users) { _, new in new },
                                statuses: presence.statuses.merging(timeline.statuses) { _, new in new },
                                currentUserID: navigation.currentUserID,
                                currentUsername: navigation.currentUserID.flatMap { navigation.users[$0]?.username },
                                onStartDirectMessage: startDirectMessage,
                                dismiss: closeThread
                            )
                            Divider().overlay(WorkspaceTheme.divider)
                            messageComposer
                        }
                        .frame(width: geometry.size.width * 0.5, height: geometry.size.height)
                        .background(WorkspaceTheme.canvas)
                        .transition(.move(edge: .trailing))
                        .zIndex(1)
                    } else if isChannelFilesPresented {
                        ChannelFilesAside(
                            files: channelFiles.files,
                            isLoading: channelFiles.isLoading,
                            error: channelFiles.error,
                            onView: channelFiles.view,
                            onDownload: channelFiles.download,
                            close: { withAnimation(.easeInOut(duration: 0.2)) { isChannelFilesPresented = false } }
                        )
                        .frame(width: geometry.size.width * 0.5, height: geometry.size.height)
                        .transition(.move(edge: .trailing))
                        .zIndex(1)
                    }
                }
            }
        }
        .background(WorkspaceTheme.canvas)
        .background(TitleBarControlAligner())
        .ignoresSafeArea(.container, edges: .top)
        .preferredColorScheme(.dark)
        .task {
            await navigation.load(preferredChannelID: route.channelID)
            composer.select(channelID: route.channelID, teamID: navigation.selectedTeamID)
            await navigation.markChannelAsRead(route.channelID, previousChannelID: nil)
            await presence.refresh(for: navigation.presenceUserIDs)
            await realtime.start()
        }
        .onChange(of: realtime.latestEvent) { _, event in
            guard let event else { return }
            presence.reconcile(event, channelID: route.channelID)
            Task {
                await timeline.reconcile(event, activeChannelID: route.channelID)
                await navigation.reconcile(event, activeChannelID: route.channelID)
            }
        }
        .onDisappear {
            registry.release(route)
            Task { await realtime.stop() }
        }
    }

    private func startDirectMessage(with user: MattermostUser) {
        let presentation = DirectMessagePresentation.current
        Task {
            guard let channel = await navigation.openDirectMessage(
                with: user,
                selectInWorkspace: presentation.selectsInWorkspace
            ) else { return }
            requestDirectMessageWindow(
                for: channel,
                session: session,
                title: navigation.displayName(for: channel),
                presentation: presentation,
                registry: registry,
                openWindow: { openWindow(value: $0) }
            )
        }
    }

    private var typingNames: [String] {
        let knownUsers = navigation.users.merging(timeline.users) { _, new in new }
        return presence.typingUserIDs
            .filter { $0 != navigation.currentUserID }
            .compactMap { knownUsers[$0]?.displayName ?? "Someone" }
            .sorted()
    }

    private func openThread(_ post: MattermostPost) {
        let rootID = post.rootID.isEmpty ? post.id : post.rootID
        withAnimation(.easeInOut(duration: 0.2)) {
            isChannelFilesPresented = false
            selectedThreadRootID = rootID
        }
        composer.reply(to: timeline.posts.first(where: { $0.id == rootID }) ?? post)
    }

    private func closeThread() {
        withAnimation(.easeInOut(duration: 0.2)) {
            selectedThreadRootID = nil
        }
        composer.cancelReply()
    }

    private var messageComposer: some View {
        MessageComposer(
            composer: composer,
            channelID: route.channelID,
            teamID: navigation.selectedTeamID,
            onSent: { post in
                Task {
                    await timeline.appendSentPost(post)
                    if let selectedThreadRootID,
                       let root = timeline.posts.first(where: { $0.id == selectedThreadRootID }) {
                        composer.reply(to: root)
                    }
                }
            },
            onTyping: {
                Task { await realtime.sendTyping(channelID: route.channelID, parentID: composer.replyRootID ?? "") }
            },
            editingPost: timeline.editingPostID.flatMap { id in timeline.posts.first(where: { $0.id == id }) },
            editMessage: $timeline.editMessage,
            onSaveEdit: timeline.saveEdit,
            onCancelEdit: timeline.cancelEditing
        )
    }
}
