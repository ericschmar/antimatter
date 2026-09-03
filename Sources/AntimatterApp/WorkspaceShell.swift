import AntimatterFoundation
import SwiftUI

struct WorkspaceShell: View {
    let configuration: AppConfiguration
    @StateObject private var navigation: NavigationViewModel
    @StateObject private var workspace: WorkspaceViewModel
    @StateObject private var timeline: TimelineViewModel
    @StateObject private var realtime: RealtimeUpdatesViewModel
    @StateObject private var composer: ComposerViewModel
    @StateObject private var presence = PresenceViewModel()
    @StateObject private var search: SearchViewModel
    @StateObject private var notifications = NotificationManager()
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focusedRegion: WorkspaceFocusTarget?
    @State private var isCommandPalettePresented = false
    @State private var isSettingsPresented = false

    init(configuration: AppConfiguration, session: MattermostSession) {
        self.configuration = configuration
        _navigation = StateObject(wrappedValue: NavigationViewModel(session: session))
        _workspace = StateObject(wrappedValue: WorkspaceViewModel())
        _timeline = StateObject(wrappedValue: TimelineViewModel(session: session))
        _realtime = StateObject(wrappedValue: RealtimeUpdatesViewModel(session: session))
        _composer = StateObject(wrappedValue: ComposerViewModel(session: session))
        _search = StateObject(wrappedValue: SearchViewModel(session: session))
    }

    var body: some View {
        VStack(spacing: 0) {
            HSplitView {
                SidebarPlaceholder(navigation: navigation, search: search, isSettingsPresented: $isSettingsPresented)
                    .frame(
                        minWidth: 220,
                        idealWidth: WorkspaceTheme.sidebarWidth,
                        maxWidth: 360,
                        maxHeight: .infinity
                    )
                    .focusable()
                    .focused($focusedRegion, equals: .sidebar)
                    .accessibilityLabel("Workspace sidebar")
                    .accessibilityHint("Contains teams, channels, and direct messages.")
                    .accessibilityIdentifier("workspace-sidebar")

                ConversationPlaceholder(
                    navigation: navigation,
                    workspace: workspace,
                    timeline: timeline,
                    composer: composer,
                    presence: presence,
                    realtime: realtime
                )
                    .frame(minWidth: 640, maxWidth: .infinity, maxHeight: .infinity)
                    .focusable()
                    .focused($focusedRegion, equals: .conversation)
                    .accessibilityLabel("Conversation workspace")
                    .accessibilityHint("Displays the selected conversation.")
                    .accessibilityIdentifier("conversation-workspace")
            }
        }
        .background(WorkspaceTheme.canvas)
        .frame(minWidth: 900, minHeight: 600)
        .preferredColorScheme(.dark)
        .focusedSceneValue(\.workspaceFocusAction, focus)
        .overlay {
            if isCommandPalettePresented {
                CommandPalette(
                    isPresented: $isCommandPalettePresented,
                    focus: focus,
                    openSearch: { focusedRegion = .sidebar }
                )
            }
        }
        .background {
            Button("") {
                isCommandPalettePresented.toggle()
            }
            .keyboardShortcut("k", modifiers: [.command])
            .opacity(0)
        }
        .sheet(isPresented: $isSettingsPresented) {
            SettingsView()
        }
        .task {
            focusedRegion = .conversation
            await navigation.load(preferredChannelID: workspace.selectedChannelID)
            await realtime.start()
            await notifications.requestPermission()
        }
        .onChange(of: realtime.latestEvent) { _, event in
            guard let event else { return }
            Task {
                await timeline.reconcile(event, activeChannelID: workspace.selectedChannelID)
                await navigation.reconcile(event)
                presence.reconcile(event, channelID: workspace.selectedChannelID)
                notifications.notify(for: event)
            }
        }
        .onChange(of: navigation.selectedChannelID) { _, channelID in
            guard let channelID, let channel = navigation.channels.first(where: { $0.id == channelID }) else { return }
            workspace.preview(channel)
        }
        .onChange(of: workspace.selectedChannelID, initial: true) { _, channelID in
            composer.select(channelID: channelID)
        }
        .onChange(of: scenePhase, initial: true) { _, newPhase in
            AppLogger.application.info(
                "Workspace scene changed to \(String(describing: newPhase), privacy: .public)."
            )
            if newPhase == .background {
                Task { await realtime.stop() }
            }
        }
    }

    private func focus(_ target: WorkspaceFocusTarget) {
        focusedRegion = target
    }
}

private struct SidebarPlaceholder: View {
    @ObservedObject var navigation: NavigationViewModel
    @ObservedObject var search: SearchViewModel
    @Binding var isSettingsPresented: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TEAM")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.7)
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                    Text(navigation.teams.first?.displayName ?? "No team")
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(WorkspaceTheme.primaryText)
                }

                Spacer(minLength: 0)

                Button {
                    isSettingsPresented = true
                } label: {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 27, weight: .medium))
                }
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
            .padding(.horizontal, 16)
            .frame(height: 72)

            Divider()
                .overlay(WorkspaceTheme.divider)

            SearchPanel(search: search) { post in
                navigation.selectedChannelID = post.channelID
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if navigation.isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .padding(14)
                    } else if let error = navigation.loadError {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundStyle(WorkspaceTheme.attention)
                            .padding(14)
                    } else {
                        ChannelSection("FAVORITES", sectionID: "favorites", channels: navigation.favoriteChannels, navigation: navigation)
                        ChannelSection("CHANNELS", sectionID: "channels", channels: navigation.regularChannels, navigation: navigation)
                        ChannelSection("DIRECT MESSAGES", sectionID: "direct", channels: navigation.directMessages, navigation: navigation)
                        ChannelSection("GROUP MESSAGES", sectionID: "group", channels: navigation.groupMessages, navigation: navigation)
                        ChannelSection("ARCHIVED", sectionID: "archived", channels: navigation.archivedChannels, navigation: navigation)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .background(WorkspaceTheme.sidebar)
    }
}

private struct ConversationPlaceholder: View {
    @ObservedObject var navigation: NavigationViewModel
    @ObservedObject var workspace: WorkspaceViewModel
    @ObservedObject var timeline: TimelineViewModel
    @ObservedObject var composer: ComposerViewModel
    @ObservedObject var presence: PresenceViewModel
    @ObservedObject var realtime: RealtimeUpdatesViewModel

    var body: some View {
        VStack(spacing: 0) {
            WorkspaceTabs(workspace: workspace)

            HStack(spacing: 10) {
                Image(systemName: "number")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.secondaryText)

                Text(selectedTab?.title ?? "Select a conversation")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
            .frame(height: WorkspaceTheme.headerHeight)
            .background(WorkspaceTheme.surface)

            Divider()
                .overlay(WorkspaceTheme.divider)

            MessageTimeline(
                timeline: timeline,
                knownUsers: navigation.users,
                statuses: presence.statuses,
                channelID: selectedTab?.channelID
            ) { post in
                composer.reply(to: post)
            }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()
                .overlay(WorkspaceTheme.divider)

            MessageComposer(composer: composer, channelID: selectedTab?.channelID) { post in
                Task { await timeline.appendSentPost(post) }
            } onTyping: {
                guard let channelID = selectedTab?.channelID else { return }
                Task { await realtime.sendTyping(channelID: channelID, parentID: composer.replyRootID ?? "") }
            }
            .overlay(alignment: .topLeading) {
                if let typingLabel = presence.typingLabel {
                    Text(typingLabel)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                        .padding(.horizontal, 14)
                        .offset(y: -14)
                }
            }
        }
        .background(WorkspaceTheme.canvas)
    }

    private var selectedTab: WorkspaceTab? {
        workspace.tabs.first(where: { $0.channelID == workspace.selectedChannelID })
    }
}
