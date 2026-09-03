import AntimatterFoundation
import SwiftUI

struct WorkspaceShell: View {
    let configuration: AppConfiguration
    let disconnect: () -> Void
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

    init(
        configuration: AppConfiguration,
        session: MattermostSession,
        disconnect: @escaping () -> Void
    ) {
        self.configuration = configuration
        self.disconnect = disconnect
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
                SidebarPlaceholder(
                    navigation: navigation,
                    presence: presence,
                    search: search,
                    disconnect: disconnect
                )
                    .frame(
                        minWidth: 220,
                        idealWidth: WorkspaceTheme.sidebarWidth,
                        maxWidth: 360,
                        maxHeight: .infinity
                    )
                    .focusable()
                    .focusEffectDisabled()
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
                    .focusEffectDisabled()
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
        .focusedSceneValue(\.workspaceSettingsAction) {
            isSettingsPresented = true
        }
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
            SettingsView(disconnect: disconnect)
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
            workspace.preview(channel, title: navigation.displayName(for: channel))
        }
        .onChange(of: navigation.users) {
            guard let channelID = workspace.selectedChannelID,
                  let channel = navigation.channels.first(where: { $0.id == channelID }) else { return }
            workspace.preview(channel, title: navigation.displayName(for: channel))
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
    @ObservedObject var presence: PresenceViewModel
    @ObservedObject var search: SearchViewModel
    let disconnect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            LargeTitleHeader(
                teams: navigation.teams,
                selectedTeamID: navigation.selectedTeamID,
                avatarData: navigation.currentUserAvatarData,
                status: navigation.currentUserID.flatMap { presence.statuses[$0] } ?? "online",
                search: search,
                onSelectTeam: navigation.selectTeam,
                onLogout: disconnect
            )
            .padding(16)

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
                        ChannelSection("FAVORITES", sectionID: "favorites", channels: navigation.favoriteChannels, navigation: navigation, presence: presence)
                        ChannelSection("CHANNELS", sectionID: "channels", channels: navigation.regularChannels, navigation: navigation, presence: presence)
                        ChannelSection("DIRECT MESSAGES", sectionID: "direct", channels: navigation.directMessages, navigation: navigation, presence: presence)
                        ChannelSection("GROUP MESSAGES", sectionID: "group", channels: navigation.groupMessages, navigation: navigation, presence: presence)
                        ChannelSection("ARCHIVED", sectionID: "archived", channels: navigation.archivedChannels, navigation: navigation, presence: presence)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .background(WorkspaceTheme.sidebar)
    }
}

private struct LargeTitleHeader: View {
    let teams: [MattermostTeam]
    let selectedTeamID: String?
    let avatarData: Data?
    let status: String
    @ObservedObject var search: SearchViewModel
    let onSelectTeam: (MattermostTeam) -> Void
    let onLogout: () -> Void
    @State private var isTeamPickerPresented = false
    @State private var isAccountMenuPresented = false

    private var selectedTeam: MattermostTeam? {
        teams.first { $0.id == selectedTeamID } ?? teams.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TEAM")
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                    Button {
                        isTeamPickerPresented.toggle()
                    } label: {
                        HStack(spacing: 7) {
                            Text(selectedTeam?.displayName ?? "No team")
                            Image(systemName: isTeamPickerPresented ? "chevron.up" : "chevron.down")
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(WorkspaceTheme.primaryText)
                        .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: $isTeamPickerPresented, arrowEdge: .bottom) {
                        TeamPicker(
                            teams: teams,
                            selectedTeamID: selectedTeamID
                        ) { team in
                            onSelectTeam(team)
                            isTeamPickerPresented = false
                        }
                    }
                }
                Spacer(minLength: 0)
                Button {
                    isAccountMenuPresented.toggle()
                } label: {
                    LoggedInAvatar(data: avatarData, status: status)
                }
                .buttonStyle(.plain)
                .popover(isPresented: $isAccountMenuPresented, arrowEdge: .trailing) {
                    AccountMenu(onLogout: onLogout)
                }
                .accessibilityLabel("Account menu")
            }

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                TextField("Search", text: $search.query)
                    .textFieldStyle(.plain)
                    .onSubmit { Task { await search.search() } }
                Spacer(minLength: 0)
                Image(systemName: "mic.fill")
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .accessibilityHidden(true)
            }
            .font(.system(size: 16))
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(WorkspaceTheme.raisedSurface, in: Capsule())
        }
    }

}

private struct LoggedInAvatar: View {
    let data: Data?
    let status: String

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let data, let image = NSImage(data: data) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "person.crop.circle.fill")
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                }
            }
            .frame(width: 66, height: 66)
            .clipShape(Circle())
            Circle()
                .fill(statusColor)
                .frame(width: 18, height: 18)
                .overlay(Circle().stroke(WorkspaceTheme.sidebar, lineWidth: 3))
        }
        .frame(width: 66, height: 66)
    }

    private var statusColor: Color {
        switch status {
        case "online": WorkspaceTheme.accent
        case "away": .yellow
        case "dnd": WorkspaceTheme.attention
        default: WorkspaceTheme.secondaryText.opacity(0.65)
        }
    }
}

private struct AccountMenu: View {
    let onLogout: () -> Void

    var body: some View {
        Button("Log Out", role: .destructive, action: onLogout)
            .buttonStyle(.plain)
            .foregroundStyle(WorkspaceTheme.attention)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(width: 150, alignment: .leading)
    }
}

private struct TeamPicker: View {
    let teams: [MattermostTeam]
    let selectedTeamID: String?
    let onSelect: (MattermostTeam) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(teams) { team in
                Button {
                    onSelect(team)
                } label: {
                    HStack {
                        Text(team.displayName)
                            .font(.system(size: 15))
                            .foregroundStyle(team.id == selectedTeamID ? WorkspaceTheme.accent : WorkspaceTheme.primaryText)
                        Spacer()
                        if team.id == selectedTeamID {
                            Image(systemName: "checkmark")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(WorkspaceTheme.accent)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                }
                .buttonStyle(.plain)
                if team.id != teams.last?.id {
                    Divider().overlay(WorkspaceTheme.divider)
                }
            }
        }
        .frame(width: 300)
        .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(WorkspaceTheme.divider, lineWidth: 1)
        }
        .padding(6)
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
