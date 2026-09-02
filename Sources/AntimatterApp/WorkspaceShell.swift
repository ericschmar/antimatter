import AntimatterFoundation
import SwiftUI

struct WorkspaceShell: View {
    let configuration: AppConfiguration
    @StateObject private var navigation: NavigationViewModel
    @StateObject private var workspace: WorkspaceViewModel
    @StateObject private var timeline: TimelineViewModel
    @StateObject private var realtime: RealtimeUpdatesViewModel
    @StateObject private var composer: ComposerViewModel
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focusedRegion: WorkspaceFocusTarget?

    init(configuration: AppConfiguration, session: MattermostSession) {
        self.configuration = configuration
        _navigation = StateObject(wrappedValue: NavigationViewModel(session: session))
        _workspace = StateObject(wrappedValue: WorkspaceViewModel())
        _timeline = StateObject(wrappedValue: TimelineViewModel(session: session))
        _realtime = StateObject(wrappedValue: RealtimeUpdatesViewModel(session: session))
        _composer = StateObject(wrappedValue: ComposerViewModel(session: session))
    }

    var body: some View {
        VStack(spacing: 0) {
            TitleStrip(environment: configuration.environment)

            HSplitView {
                SidebarPlaceholder(navigation: navigation)
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
                    .overlay {
                        FocusRing(isVisible: focusedRegion == .sidebar)
                    }

                ConversationPlaceholder(workspace: workspace, timeline: timeline, composer: composer)
                    .frame(minWidth: 640, maxWidth: .infinity, maxHeight: .infinity)
                    .focusable()
                    .focused($focusedRegion, equals: .conversation)
                    .accessibilityLabel("Conversation workspace")
                    .accessibilityHint("Displays the selected conversation.")
                    .accessibilityIdentifier("conversation-workspace")
                    .overlay {
                        FocusRing(isVisible: focusedRegion == .conversation)
                    }
            }
        }
        .background(WorkspaceTheme.canvas)
        .frame(minWidth: 900, minHeight: 600)
        .preferredColorScheme(.dark)
        .focusedSceneValue(\.workspaceFocusAction, focus)
        .task {
            focusedRegion = .conversation
            await navigation.load(preferredChannelID: workspace.selectedChannelID)
            await realtime.start()
        }
        .onChange(of: realtime.latestEvent) { _, event in
            guard let event else { return }
            Task {
                await timeline.reconcile(event, activeChannelID: workspace.selectedChannelID)
                await navigation.reconcile(event)
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

private struct FocusRing: View {
    let isVisible: Bool

    var body: some View {
        Rectangle()
            .strokeBorder(WorkspaceTheme.accent.opacity(isVisible ? 0.9 : 0), lineWidth: 2)
            .padding(1)
            .allowsHitTesting(false)
    }
}

private struct TitleStrip: View {
    let environment: AppConfiguration.Environment

    var body: some View {
        HStack(spacing: 8) {
            Text("ANTIMATTER")
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(WorkspaceTheme.primaryText)

            Text("NATIVE")
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .tracking(0.6)
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(WorkspaceTheme.raisedSurface)
                .clipShape(RoundedRectangle(cornerRadius: WorkspaceTheme.compactCornerRadius))

            Spacer(minLength: 0)

            Text(environment.rawValue.uppercased())
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(
                    environment == .development ? WorkspaceTheme.attention : WorkspaceTheme.secondaryText
                )
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .frame(height: WorkspaceTheme.titleHeight)
        .background(WorkspaceTheme.sidebar)
        .overlay(alignment: .bottom) {
            Divider()
                .overlay(WorkspaceTheme.divider)
        }
    }
}

private struct SidebarPlaceholder: View {
    @ObservedObject var navigation: NavigationViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("WORKSPACE")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.7)
                    .foregroundStyle(WorkspaceTheme.secondaryText)

                Spacer(minLength: 0)

                Image(systemName: "gearshape")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
            .padding(.horizontal, 14)
            .frame(height: WorkspaceTheme.headerHeight)

            Divider()
                .overlay(WorkspaceTheme.divider)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
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
                        ForEach(navigation.teams) { team in
                            Text(team.displayName.uppercased())
                                .font(.system(size: 10, weight: .semibold))
                                .tracking(0.7)
                                .foregroundStyle(WorkspaceTheme.secondaryText)
                                .padding(.horizontal, 14)
                        }
                        ChannelSection("FAVORITES", channels: navigation.favoriteChannels, navigation: navigation)
                        ChannelSection("CHANNELS", channels: navigation.publicChannels, navigation: navigation)
                        ChannelSection("PRIVATE", channels: navigation.privateChannels, navigation: navigation)
                        ChannelSection("DIRECT MESSAGES", channels: navigation.directMessages, navigation: navigation)
                        ChannelSection("GROUP MESSAGES", channels: navigation.groupMessages, navigation: navigation)
                        ChannelSection("ARCHIVED", channels: navigation.archivedChannels, navigation: navigation)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .background(WorkspaceTheme.sidebar)
    }
}

private struct ConversationPlaceholder: View {
    @ObservedObject var workspace: WorkspaceViewModel
    @ObservedObject var timeline: TimelineViewModel
    @ObservedObject var composer: ComposerViewModel

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

            MessageTimeline(timeline: timeline, channelID: selectedTab?.channelID) { post in
                composer.reply(to: post)
            }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()
                .overlay(WorkspaceTheme.divider)

            MessageComposer(composer: composer, channelID: selectedTab?.channelID) { post in
                Task { await timeline.appendSentPost(post) }
            }
        }
        .background(WorkspaceTheme.canvas)
    }

    private var selectedTab: WorkspaceTab? {
        workspace.tabs.first(where: { $0.channelID == workspace.selectedChannelID })
    }
}
