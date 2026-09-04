import AntimatterFoundation
import AppKit
import SwiftUI

struct WorkspaceShell: View {
    let configuration: AppConfiguration
    let disconnect: () -> Void
    @EnvironmentObject private var accentColorSettings: AccentColorSettings
    @EnvironmentObject private var userColorSettings: UserColorSettings
    @StateObject private var navigation: NavigationViewModel
    @StateObject private var workspace: WorkspaceViewModel
    @StateObject private var timeline: TimelineViewModel
    @StateObject private var realtime: RealtimeUpdatesViewModel
    @StateObject private var composer: ComposerViewModel
    @StateObject private var channelFiles: ChannelFilesViewModel
    @StateObject private var presence: PresenceViewModel
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
        _composer = StateObject(wrappedValue: ComposerViewModel(
            session: session,
            giphyAPIKey: configuration.giphyAPIKey
        ))
        _channelFiles = StateObject(wrappedValue: ChannelFilesViewModel(session: session))
        _presence = StateObject(wrappedValue: PresenceViewModel(session: session))
        _search = StateObject(wrappedValue: SearchViewModel(session: session))
    }

    var body: some View {
        let accentColor = accentColorSettings.selected.color

        VStack(spacing: 0) {
            HSplitView {
                SidebarPlaceholder(
                    navigation: navigation,
                    presence: presence,
                    search: search,
                    onSearch: performSearch,
                    onOpenSettings: { isSettingsPresented = true },
                    onOpenPermanently: openPermanently,
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
                    .ignoresSafeArea(.container, edges: .top)

                ConversationPlaceholder(
                    navigation: navigation,
                    workspace: workspace,
                    timeline: timeline,
                    composer: composer,
                    channelFiles: channelFiles,
                    presence: presence,
                    realtime: realtime,
                    search: search
                )
                    .frame(minWidth: 640, maxWidth: .infinity, maxHeight: .infinity)
                    .focusable()
                    .focusEffectDisabled()
                    .focused($focusedRegion, equals: .conversation)
                    .accessibilityLabel("Conversation workspace")
                    .accessibilityHint("Displays the selected conversation.")
                    .accessibilityIdentifier("conversation-workspace")
                    .ignoresSafeArea(.container, edges: .top)
            }
        }
        .tint(accentColor)
        .background(WorkspaceTheme.canvas)
        .frame(minWidth: 900, minHeight: 600)
        .background(TitleBarControlAligner())
        .preferredColorScheme(.dark)
        .focusedSceneValue(\.workspaceFocusAction, focus)
        .focusedSceneValue(\.workspaceTabAction, performTabAction)
        .focusedSceneValue(\.workspaceSettingsAction) {
            isSettingsPresented = true
        }
        .overlay {
            if isCommandPalettePresented {
                CommandPalette(
                    isPresented: $isCommandPalettePresented,
                    focus: focus,
                    openSearch: runPaletteSearch
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
            userColorSettings.assignColors(to: navigation.users.keys)
            await presence.refresh(for: navigation.presenceUserIDs)
            await realtime.start()
            await notifications.requestPermission()
        }
        .onChange(of: realtime.latestEvent) { _, event in
            guard let event else { return }
            Task {
                await timeline.reconcile(event, activeChannelID: workspace.selectedChannelID)
                await navigation.reconcile(event, activeChannelID: workspace.selectedChannelID)
                presence.reconcile(event, channelID: workspace.selectedChannelID)
                let notificationPost = event.decodedData(MattermostPost.self, forKey: "post")
                let senderName = notificationPost.flatMap { navigation.users[$0.userID]?.displayName }
                let channelName = notificationPost
                    .flatMap { post in navigation.channels.first { $0.id == post.channelID } }
                    .map(navigation.displayName)
                notifications.notify(
                    for: event,
                    currentUserID: navigation.currentUserID,
                    senderName: senderName,
                    channelName: channelName
                )
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
        .onChange(of: workspace.selectedChannelID, initial: true) { previousChannelID, channelID in
            guard !workspace.isSearchResultsSelected else { return }
            if navigation.selectedChannelID != channelID {
                navigation.selectedChannelID = channelID
            }
            composer.select(channelID: channelID, teamID: navigation.selectedTeamID)
            presence.clearTypingIndicators()
            if let channelID {
                Task {
                    await navigation.markChannelAsRead(channelID, previousChannelID: previousChannelID)
                }
            }
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

    private func performTabAction(_ action: WorkspaceTabAction) {
        switch action {
        case .closeSelected:
            workspace.closeSelected()
        case .selectPrevious:
            workspace.selectPrevious()
        case .selectNext:
            workspace.selectNext()
        }
    }

    private func openPermanently(_ channel: MattermostChannel) {
        workspace.openPermanently(channel, title: navigation.displayName(for: channel))
    }

    private func performSearch() {
        let query = search.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        workspace.openSearchResults(for: query)
        Task { await search.search() }
    }

    private func runPaletteSearch(_ query: String) {
        search.query = query
        focusedRegion = .sidebar
        performSearch()
    }
}

private struct SidebarPlaceholder: View {
    @ObservedObject var navigation: NavigationViewModel
    @ObservedObject var presence: PresenceViewModel
    @ObservedObject var search: SearchViewModel
    let onSearch: () -> Void
    let onOpenSettings: () -> Void
    let onOpenPermanently: (MattermostChannel) -> Void
    let disconnect: () -> Void
    @State private var isCreateChannelPresented = false
    @State private var isNewDirectMessagePresented = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CommandDeckHeader(
                teams: navigation.teams,
                selectedTeamID: navigation.selectedTeamID,
                avatarData: navigation.currentUserAvatarData,
                currentUser: navigation.currentUserID.flatMap { navigation.users[$0] },
                status: navigation.currentUserID.flatMap { presence.statuses[$0] },
                search: search,
                onSearch: onSearch,
                onSelectTeam: navigation.selectTeam,
                onOpenSettings: onOpenSettings,
                onLogout: disconnect
            )

            AttentionShelf(
                mentionCount: navigation.mentionCount,
                unreadChannelCount: navigation.unreadChannelCount
            )

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if navigation.isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .frame(maxWidth: .infinity)
                            .padding(14)
                    } else if let error = navigation.loadError {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundStyle(WorkspaceTheme.attention)
                            .padding(14)
                    } else {
                        ChannelSection("FAVORITES", sectionID: "favorites", channels: navigation.favoriteChannels, navigation: navigation, presence: presence, onOpenPermanently: onOpenPermanently)
                        ChannelSection("CHANNELS", sectionID: "channels", channels: navigation.regularChannels, navigation: navigation, presence: presence, onOpenPermanently: onOpenPermanently) {
                            isCreateChannelPresented = true
                        }
                        ChannelSection("DIRECT MESSAGES", sectionID: "direct", channels: navigation.directMessages, navigation: navigation, presence: presence, onOpenPermanently: onOpenPermanently) {
                            isNewDirectMessagePresented = true
                        }
                        ChannelSection("GROUP MESSAGES", sectionID: "group", channels: navigation.groupMessages, navigation: navigation, presence: presence, onOpenPermanently: onOpenPermanently)
                        ChannelSection("ARCHIVED", sectionID: "archived", channels: navigation.archivedChannels, navigation: navigation, presence: presence, onOpenPermanently: onOpenPermanently)
                    }
                }
                .padding(.vertical, 8)
            }
            .background(OverlayScrollerConfigurator())
        }
        .background(WorkspaceTheme.sidebar)
        .sheet(isPresented: $isCreateChannelPresented) {
            CreateChannelSheet { name, purpose, isPrivate in
                Task { await navigation.createChannel(displayName: name, purpose: purpose, isPrivate: isPrivate) }
            }
        }
        .sheet(isPresented: $isNewDirectMessagePresented) {
            UserPickerSheet(
                title: "Start a direct message",
                users: availableUsers,
                actionTitle: "Message"
            ) { user in
                Task { await navigation.openDirectMessage(with: user) }
            }
        }
    }

    private var availableUsers: [MattermostUser] {
        navigation.users.values
            .filter { $0.id != navigation.currentUserID }
            .sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
    }
}

private struct OverlayScrollerConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        NSView()
    }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let scrollView = enclosingScrollView(for: view) else { return }
            scrollView.scrollerStyle = .overlay
            scrollView.autohidesScrollers = true
        }
    }

    private func enclosingScrollView(for view: NSView) -> NSScrollView? {
        var ancestor: NSView? = view
        while let current = ancestor {
            if let scrollView = current as? NSScrollView {
                return scrollView
            }
            ancestor = current.superview
        }
        return nil
    }
}

private struct TitleBarControlAligner: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        NSView()
    }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            let controlTypes: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]

            for controlType in controlTypes {
                guard let button = window.standardWindowButton(controlType),
                      let container = button.superview
                else {
                    continue
                }

                let originY = container.bounds.maxY
                    - WorkspaceTheme.titleBarContentHeight / 2
                    - button.frame.height / 2
                button.setFrameOrigin(NSPoint(x: button.frame.minX, y: originY))
            }
        }
    }
}

private struct CommandDeckHeader: View {
    let teams: [MattermostTeam]
    let selectedTeamID: String?
    let avatarData: Data?
    let currentUser: MattermostUser?
    let status: String?
    @ObservedObject var search: SearchViewModel
    let onSearch: () -> Void
    let onSelectTeam: (MattermostTeam) -> Void
    let onOpenSettings: () -> Void
    let onLogout: () -> Void
    @State private var isTeamPickerPresented = false
    @State private var isAccountMenuPresented = false

    private var selectedTeam: MattermostTeam? {
        teams.first { $0.id == selectedTeamID } ?? teams.first
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    isTeamPickerPresented.toggle()
                } label: {
                    HStack(spacing: 6) {
                        Text(selectedTeam?.displayName ?? "No team")
                            .lineLimit(1)
                        Image(systemName: isTeamPickerPresented ? "chevron.up" : "chevron.down")
                            .font(.system(size: 9, weight: .bold))
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                }
                .buttonStyle(.plain)
                .popover(isPresented: $isTeamPickerPresented, arrowEdge: .bottom) {
                    TeamPicker(teams: teams, selectedTeamID: selectedTeamID) { team in
                        onSelectTeam(team)
                        isTeamPickerPresented = false
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
                    AccountMenu(
                        user: currentUser,
                        avatarData: avatarData,
                        status: status,
                        onOpenSettings: {
                            isAccountMenuPresented = false
                            onOpenSettings()
                        },
                        onLogout: onLogout
                    )
                }
                .accessibilityLabel("Account menu")
            }
            .frame(height: WorkspaceTheme.titleBarContentHeight)
            .padding(.leading, WorkspaceTheme.titleBarControlInset)

            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                TextField("Search conversations", text: $search.query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .onSubmit(onSearch)
                Spacer(minLength: 0)
                Text("⌘ K")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(WorkspaceTheme.raisedSurface, in: RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius, style: .continuous))
            .padding(.bottom, 8)
        }
        .padding(.horizontal, 14)
    }
}

private struct AttentionShelf: View {
    let mentionCount: Int
    let unreadChannelCount: Int

    var body: some View {
        if mentionCount > 0 || unreadChannelCount > 0 {
            VStack(spacing: 1) {
                if mentionCount > 0 {
                    AttentionShelfRow(symbol: "at", title: "Mentions", count: mentionCount, tint: WorkspaceTheme.attention)
                }
                if unreadChannelCount > 0 {
                    AttentionShelfRow(symbol: "circle.fill", title: "Unread", count: unreadChannelCount, tint: WorkspaceTheme.accent)
                }
            }
            .padding(.vertical, 6)
            .background(WorkspaceTheme.surface.opacity(0.45))
        }
    }
}

private struct AttentionShelfRow: View {
    let symbol: String
    let title: String
    let count: Int
    let tint: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 12)
            Text(title)
            Spacer(minLength: 0)
            Text(String(count))
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(tint)
        }
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(WorkspaceTheme.secondaryText)
        .padding(.horizontal, 16)
        .frame(height: 24)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(count)")
    }
}

private struct LoggedInAvatar: View {
    let data: Data?
    let status: String?

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
            .frame(width: 28, height: 28)
            .clipShape(Circle())
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)
                .overlay(Circle().stroke(WorkspaceTheme.sidebar, lineWidth: 1.5))
        }
        .frame(width: 28, height: 28)
    }

    private var statusColor: Color {
        switch status {
        case "online": .green
        case "away": .yellow
        case "dnd": WorkspaceTheme.attention
        default: WorkspaceTheme.secondaryText.opacity(0.65)
        }
    }
}

private struct AccountMenu: View {
    let user: MattermostUser?
    let avatarData: Data?
    let status: String?
    let onOpenSettings: () -> Void
    let onLogout: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                accountAvatar
                VStack(alignment: .leading, spacing: 3) {
                    Text(user?.displayName ?? "Signed in")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(WorkspaceTheme.primaryText)
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 6, height: 6)
                        Text(statusLabel)
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                }
                Spacer(minLength: 0)
            }
            .padding(14)

            Divider().overlay(WorkspaceTheme.divider)

            AccountMenuRow("gearshape", title: "Settings", shortcut: "⌘,") {
                onOpenSettings()
            }

            Divider().overlay(WorkspaceTheme.divider)
                .padding(.vertical, 5)

            AccountMenuRow("rectangle.portrait.and.arrow.right", title: "Log Out", tint: WorkspaceTheme.attention, action: onLogout)
        }
        .frame(width: 248)
        .padding(6)
        .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(WorkspaceTheme.divider, lineWidth: 1)
        }
    }

    private var accountAvatar: some View {
        Group {
            if let avatarData, let image = NSImage(data: avatarData) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(initials)
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
        }
        .frame(width: 34, height: 34)
        .background(WorkspaceTheme.raisedSurface)
        .clipShape(Circle())
    }

    private var initials: String {
        String((user?.displayName ?? "Signed in").split(separator: " ").prefix(2).compactMap(\.first)).uppercased()
    }

    private var statusLabel: String {
        switch status {
        case "online": "Online"
        case "away": "Away"
        case "dnd": "Do not disturb"
        default: "Offline"
        }
    }

    private var statusColor: Color {
        switch status {
        case "online": .green
        case "away": .yellow
        case "dnd": WorkspaceTheme.attention
        default: WorkspaceTheme.secondaryText.opacity(0.65)
        }
    }
}

private struct AccountMenuRow: View {
    let symbol: String
    let title: String
    var shortcut: String? = nil
    var tint = WorkspaceTheme.primaryText
    let action: () -> Void

    init(_ symbol: String, title: String, shortcut: String? = nil, tint: Color = WorkspaceTheme.primaryText, action: @escaping () -> Void) {
        self.symbol = symbol
        self.title = title
        self.shortcut = shortcut
        self.tint = tint
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .medium))
                    .frame(width: 16)
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                Spacer(minLength: 0)
                if let shortcut {
                    Text(shortcut)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                }
            }
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct TeamPicker: View {
    let teams: [MattermostTeam]
    let selectedTeamID: String?
    let onSelect: (MattermostTeam) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Switch team")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                Spacer()
                Text("\(teams.count)")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(WorkspaceTheme.raisedSurface, in: Capsule())
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            Divider().overlay(WorkspaceTheme.divider)

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(teams) { team in
                        Button {
                            onSelect(team)
                        } label: {
                            HStack(spacing: 10) {
                                Text(initials(for: team.displayName))
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(team.id == selectedTeamID ? WorkspaceTheme.canvas : WorkspaceTheme.secondaryText)
                                    .frame(width: 30, height: 30)
                                    .background(team.id == selectedTeamID ? WorkspaceTheme.navigationAccent : WorkspaceTheme.raisedSurface, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                Text(team.displayName)
                                    .font(.system(size: 13, weight: team.id == selectedTeamID ? .semibold : .regular))
                                    .foregroundStyle(WorkspaceTheme.primaryText)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                                if team.id == selectedTeamID {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundStyle(WorkspaceTheme.navigationAccent)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(team.id == selectedTeamID ? WorkspaceTheme.hoverSurface : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(6)
            }
            .frame(maxHeight: 244)
        }
        .frame(width: 292)
        .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(WorkspaceTheme.divider, lineWidth: 1)
        }
        .padding(6)
    }

    private func initials(for name: String) -> String {
        String(name.split(separator: " ").prefix(2).compactMap(\.first)).uppercased()
    }
}

private struct ConversationPlaceholder: View {
    @ObservedObject var navigation: NavigationViewModel
    @ObservedObject var workspace: WorkspaceViewModel
    @ObservedObject var timeline: TimelineViewModel
    @ObservedObject var composer: ComposerViewModel
    @ObservedObject var channelFiles: ChannelFilesViewModel
    @ObservedObject var presence: PresenceViewModel
    @ObservedObject var realtime: RealtimeUpdatesViewModel
    @ObservedObject var search: SearchViewModel
    @State private var isAddMemberPresented = false
    @State private var isChannelFilesPresented = false

    var body: some View {
        VStack(spacing: 0) {
            WorkspaceTabs(workspace: workspace)

            HStack(spacing: 10) {
                Text(selectedTab?.title ?? "Select a conversation")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)

                if let channelDescription {
                    Text(channelDescription)
                        .font(.system(size: 12))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }

                Spacer(minLength: 0)
                if selectedTab?.isSearchResults != true {
                    ChannelParticipantStack(participants: channelParticipants)
                    if canAddMembers {
                        Button {
                            isAddMemberPresented = true
                        } label: {
                            Image(systemName: "person.badge.plus")
                                .font(.system(size: 14, weight: .semibold))
                                .frame(width: 28, height: 28)
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                        .accessibilityLabel("Add member to chat")
                        .accessibilityHint("Choose a teammate to add to this chat.")
                    }
                    Button {
                        isChannelFilesPresented.toggle()
                        if isChannelFilesPresented, let channelID = selectedTab?.channelID {
                            channelFiles.load(channelID: channelID)
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
                    .accessibilityHint("Shows files shared in this channel.")
                }
            }
            .padding(.horizontal, 18)
            .frame(height: WorkspaceTheme.headerHeight)
            .background(WorkspaceTheme.surface)

            Divider()
                .overlay(WorkspaceTheme.divider)

            if selectedTab?.isSearchResults == true {
                SearchResultsView(
                    search: search,
                    channels: navigation.channels,
                    users: navigation.users,
                    onSelect: openSearchResult
                )
            } else {
                HStack(spacing: 0) {
                    VStack(spacing: 0) {
                        MessageTimeline(
                            timeline: timeline,
                            knownUsers: navigation.users,
                            statuses: presence.statuses,
                            currentUserID: navigation.currentUserID,
                            currentUsername: navigation.currentUserID.flatMap { navigation.users[$0]?.username },
                            channelID: selectedTab?.channelID,
                            focusedPostID: workspace.focusedPostID,
                            onStartDirectMessage: { user in
                                Task {
                                    await navigation.openDirectMessage(with: user)
                                }
                            }
                        ) { post in
                            composer.reply(to: post)
                        } onVote: { post, actionID in
                            timeline.vote(on: post, actionID: actionID)
                        } onFocusedPostDisplayed: { postID in
                            workspace.clearFocusedPost(id: postID)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        if presence.hasTypingUsers {
                            ChatTypingIndicator()
                        }

                        Divider()
                            .overlay(WorkspaceTheme.divider)

                        MessageComposer(composer: composer, channelID: selectedTab?.channelID, teamID: pollTeamID) { post in
                            Task { await timeline.appendSentPost(post) }
                        } onTyping: {
                            guard let channelID = selectedTab?.channelID else { return }
                            Task { await realtime.sendTyping(channelID: channelID, parentID: composer.replyRootID ?? "") }
                        }
                    }

                    if isChannelFilesPresented {
                        Divider()
                            .overlay(WorkspaceTheme.divider)
                        ChannelFilesAside(
                            files: channelFiles.files,
                            isLoading: channelFiles.isLoading,
                            error: channelFiles.error,
                            close: { isChannelFilesPresented = false }
                        )
                    }
                }
            }
        }
        .background(WorkspaceTheme.canvas)
        .sheet(isPresented: $isAddMemberPresented) {
            UserPickerSheet(
                title: "Add a member",
                users: availableMembers,
                actionTitle: "Add to chat"
            ) { user in
                guard let channelID = selectedTab?.channelID else { return }
                Task { await navigation.addMember(user, to: channelID) }
            }
        }
        .onChange(of: selectedTab?.channelID) { _, channelID in
            guard isChannelFilesPresented, let channelID else { return }
            channelFiles.load(channelID: channelID)
        }
    }

    private var selectedTab: WorkspaceTab? {
        workspace.tabs.first(where: { $0.channelID == workspace.selectedChannelID })
    }

    private func openSearchResult(_ post: MattermostPost) {
        guard let channel = navigation.channels.first(where: { $0.id == post.channelID }) else { return }
        workspace.openPermanently(
            channel,
            title: navigation.displayName(for: channel),
            focusedPostID: post.id
        )
    }

    private var pollTeamID: String? {
        guard let channelID = selectedTab?.channelID else { return navigation.selectedTeamID }
        let channelTeamID = navigation.channels.first(where: { $0.id == channelID })?.teamID ?? ""
        return channelTeamID.isEmpty ? navigation.selectedTeamID : channelTeamID
    }

    private var channelDescription: String? {
        guard
            let channelID = selectedTab?.channelID,
            let description = navigation.channels.first(where: { $0.id == channelID })?.description,
            !description.isEmpty
        else {
            return nil
        }
        return description
    }

    private var channelParticipants: [ChannelParticipant] {
        let users = navigation.users.merging(timeline.users) { _, timelineUser in timelineUser }
        var seenUserIDs = Set<String>()
        return timeline.posts.reversed().compactMap { post in
            guard seenUserIDs.insert(post.userID).inserted else { return nil }
            let user = users[post.userID]
            return ChannelParticipant(
                id: post.userID,
                displayName: user?.displayName ?? "Unknown member",
                avatarData: timeline.avatarData[post.userID]
            )
        }
    }

    private var selectedChannel: MattermostChannel? {
        guard let channelID = selectedTab?.channelID else { return nil }
        return navigation.channels.first { $0.id == channelID }
    }

    private var canAddMembers: Bool {
        guard let selectedChannel else { return false }
        return selectedChannel.type == "O" || selectedChannel.type == "P" || selectedChannel.type == "G"
    }

    private var availableMembers: [MattermostUser] {
        let participantIDs = Set(channelParticipants.map(\.id))
        return navigation.users.values
            .filter { !participantIDs.contains($0.id) && $0.id != navigation.currentUserID }
            .sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
    }
}

private struct ChannelParticipant: Identifiable {
    let id: String
    let displayName: String
    let avatarData: Data?
}

private struct CreateChannelSheet: View {
    let create: (String, String, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var purpose = ""
    @State private var isPrivate = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Create a channel")
                .font(.system(size: 18, weight: .semibold))
            TextField("Channel name", text: $name)
                .textFieldStyle(.roundedBorder)
            TextField("Purpose (optional)", text: $purpose)
                .textFieldStyle(.roundedBorder)
            Toggle("Private channel", isOn: $isPrivate)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Create") {
                    create(name, purpose, isPrivate)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 360)
        .background(WorkspaceTheme.surface)
    }
}

private struct UserPickerSheet: View {
    let title: String
    let users: [MattermostUser]
    let actionTitle: String
    let select: (MattermostUser) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.system(size: 18, weight: .semibold))
            TextField("Search people", text: $query)
                .textFieldStyle(.roundedBorder)
            List(filteredUsers) { user in
                Button {
                    select(user)
                    dismiss()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.displayName)
                        Text("@\(user.username)")
                            .font(.system(size: 11))
                            .foregroundStyle(WorkspaceTheme.secondaryText)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(actionTitle) \(user.displayName)")
            }
            .listStyle(.inset)
            .frame(height: 260)
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(24)
        .frame(width: 360)
        .background(WorkspaceTheme.surface)
    }

    private var filteredUsers: [MattermostUser] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else { return users }
        return users.filter {
            $0.displayName.localizedCaseInsensitiveContains(trimmedQuery) ||
                $0.username.localizedCaseInsensitiveContains(trimmedQuery)
        }
    }
}

private struct ChannelParticipantStack: View {
    let participants: [ChannelParticipant]
    private let visibleParticipantCount = 4
    @State private var isMemberListPresented = false

    var body: some View {
        Button {
            isMemberListPresented.toggle()
        } label: {
            HStack(spacing: -9) {
                ForEach(participants.prefix(visibleParticipantCount)) { participant in
                    Group {
                        if let data = participant.avatarData, let image = NSImage(data: data) {
                            Image(nsImage: image).resizable().scaledToFill()
                        } else {
                            Text(initials(for: participant.displayName))
                                .font(.system(size: 9, weight: .bold, design: .monospaced))
                                .foregroundStyle(WorkspaceTheme.secondaryText)
                        }
                    }
                    .frame(width: 28, height: 28)
                    .background(WorkspaceTheme.raisedSurface)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(WorkspaceTheme.surface, lineWidth: 2))
                }

                if participants.count > visibleParticipantCount {
                    Text("+\(participants.count - visibleParticipantCount)")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(WorkspaceTheme.secondaryText)
                        .frame(width: 28, height: 28)
                        .background(WorkspaceTheme.raisedSurface)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(WorkspaceTheme.surface, lineWidth: 2))
                }
            }
        }
        .buttonStyle(.plain)
        .popover(isPresented: $isMemberListPresented, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Channel members")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)
                    .padding(12)
                Divider().overlay(WorkspaceTheme.divider)
                ForEach(participants) { participant in
                    HStack(spacing: 8) {
                        Group {
                            if let data = participant.avatarData, let image = NSImage(data: data) {
                                Image(nsImage: image).resizable().scaledToFill()
                            } else {
                                Text(initials(for: participant.displayName))
                                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                                    .foregroundStyle(WorkspaceTheme.secondaryText)
                            }
                        }
                        .frame(width: 22, height: 22)
                        .background(WorkspaceTheme.raisedSurface)
                        .clipShape(Circle())
                        Text(participant.displayName)
                            .font(.system(size: 12))
                            .foregroundStyle(WorkspaceTheme.primaryText)
                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                }
            }
            .frame(width: 220)
            .background(WorkspaceTheme.surface)
        }
        .accessibilityLabel("\(participants.count) channel participants")
    }

    private func initials(for name: String) -> String {
        String(name.split(separator: " ").prefix(2).compactMap(\.first)).uppercased()
    }
}
