import AntimatterFoundation
import SwiftUI

struct WorkspaceShell: View {
    let configuration: AppConfiguration
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focusedRegion: WorkspaceFocusTarget?

    var body: some View {
        VStack(spacing: 0) {
            TitleStrip(environment: configuration.environment)

            HSplitView {
                SidebarPlaceholder()
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

                ConversationPlaceholder()
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
        }
        .onChange(of: scenePhase, initial: true) { _, newPhase in
            AppLogger.application.info(
                "Workspace scene changed to \(String(describing: newPhase), privacy: .public)."
            )
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

            VStack(alignment: .leading, spacing: 8) {
                Text("Connect a server to begin.")
                    .font(.system(size: 13))
                    .foregroundStyle(WorkspaceTheme.secondaryText)

                Text("Teams, channels, and direct messages will appear here.")
                    .font(.system(size: 12))
                    .foregroundStyle(WorkspaceTheme.secondaryText.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)

            Spacer(minLength: 0)
        }
        .background(WorkspaceTheme.sidebar)
    }
}

private struct ConversationPlaceholder: View {
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "number")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.secondaryText)

                Text("Select a conversation")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WorkspaceTheme.primaryText)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
            .frame(height: WorkspaceTheme.headerHeight)
            .background(WorkspaceTheme.surface)

            Divider()
                .overlay(WorkspaceTheme.divider)

            VStack(spacing: 10) {
                Image(systemName: "rectangle.split.3x1")
                    .font(.system(size: 28, weight: .light))
                    .foregroundStyle(WorkspaceTheme.secondaryText)

                Text("Conversation workspace")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(WorkspaceTheme.primaryText)

                Text("The desktop message workspace will appear here.")
                    .font(.system(size: 13))
                    .foregroundStyle(WorkspaceTheme.secondaryText)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(WorkspaceTheme.canvas)
    }
}
