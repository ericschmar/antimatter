import SwiftUI

struct SettingsView: View {
    private enum Section: String, CaseIterable, Identifiable {
        case general
        case appearance
        case notifications
        case workspace
        case account

        var id: Self { self }

        var title: String {
            switch self {
            case .general: "General"
            case .appearance: "Appearance"
            case .notifications: "Notifications"
            case .workspace: "Workspace"
            case .account: "Account"
            }
        }

        var symbolName: String {
            switch self {
            case .general: "gearshape"
            case .appearance: "paintbrush"
            case .notifications: "bell"
            case .workspace: "rectangle.3.group"
            case .account: "person.crop.circle"
            }
        }
    }

    let disconnect: () -> Void
    @State private var selection: Section? = .general
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("compactTimeline") private var compactTimeline = true
    @AppStorage("showTimelineAvatars") private var showTimelineAvatars = true
    @AppStorage("messageFontSize") private var messageFontSize = 12.0
    @AppStorage("messageGroupingIntervalMinutes") private var messageGroupingIntervalMinutes = 5.0
    @AppStorage("followSystemAppearance") private var followSystemAppearance = false
    @AppStorage("workspaceOpenPreviews") private var openPreviews = true

    var body: some View {
        NavigationSplitView {
            List(Section.allCases, selection: $selection) { section in
                Label(section.title, systemImage: section.symbolName)
                    .tag(section)
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 175, ideal: 190, max: 220)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let selection {
                        settingsContent(for: selection)
                    }
                }
                .frame(maxWidth: 520, alignment: .leading)
                .padding(.horizontal, 36)
                .padding(.vertical, 30)
            }
            .background(WorkspaceTheme.canvas)
        }
        .navigationTitle("Settings")
        .frame(width: 780, height: 540)
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private func settingsContent(for section: Section) -> some View {
        switch section {
        case .general:
            SettingsPageHeader("General", subtitle: "Set up the essentials for your Antimatter workspace.")
            SettingsGroup {
                SettingsValueRow("Message font size", value: "\(Int(messageFontSize)) pt") {
                    Stepper("Message font size", value: $messageFontSize, in: 10...20, step: 1)
                        .labelsHidden()
                }
                SettingsDivider()
                SettingsValueRow("Message grouping", value: groupingIntervalValue) {
                    Stepper("Message grouping interval", value: $messageGroupingIntervalMinutes, in: 0...60, step: 1)
                        .labelsHidden()
                }
            }

        case .appearance:
            SettingsPageHeader("Appearance", subtitle: "Control the density and visual treatment of your timeline.")
            SettingsGroup {
                SettingsToggleRow("Follow system appearance", isOn: $followSystemAppearance)
                SettingsDivider()
                SettingsToggleRow("Use compact message timeline", isOn: $compactTimeline)
                SettingsDivider()
                SettingsToggleRow("Show user avatars", isOn: $showTimelineAvatars)
            }

        case .notifications:
            SettingsPageHeader("Notifications", subtitle: "Choose whether Antimatter can alert you about activity.")
            SettingsGroup {
                SettingsToggleRow("Enable notifications", isOn: $notificationsEnabled)
            }

        case .workspace:
            SettingsPageHeader("Workspace", subtitle: "Choose how conversations open in your workspace.")
            SettingsGroup {
                SettingsToggleRow("Open channels as previews", isOn: $openPreviews)
            }

        case .account:
            SettingsPageHeader("Account", subtitle: "Manage your current Mattermost connection.")
            SettingsGroup {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Mattermost account")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(WorkspaceTheme.primaryText)
                        Text("Disconnecting removes this account from Antimatter.")
                            .font(.system(size: 12))
                            .foregroundStyle(WorkspaceTheme.secondaryText)
                    }
                    Spacer(minLength: 20)
                    Button("Disconnect", role: .destructive, action: disconnect)
                        .buttonStyle(.bordered)
                        .tint(.red)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
            }
        }
    }

    private var groupingIntervalValue: String {
        messageGroupingIntervalMinutes == 0 ? "Off" : "\(Int(messageGroupingIntervalMinutes)) min"
    }
}

private struct SettingsPageHeader: View {
    let title: String
    let subtitle: String

    init(_ title: String, subtitle: String) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(WorkspaceTheme.primaryText)
            Text(subtitle)
                .font(.system(size: 13))
                .foregroundStyle(WorkspaceTheme.secondaryText)
        }
    }
}

private struct SettingsGroup<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(WorkspaceTheme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(WorkspaceTheme.divider, lineWidth: 1)
        }
    }
}

private struct SettingsToggleRow: View {
    let title: String
    @Binding var isOn: Bool

    init(_ title: String, isOn: Binding<Bool>) {
        self.title = title
        _isOn = isOn
    }

    var body: some View {
        Toggle(title, isOn: $isOn)
            .font(.system(size: 13))
            .foregroundStyle(WorkspaceTheme.primaryText)
            .toggleStyle(.switch)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
    }
}

private struct SettingsValueRow<Control: View>: View {
    let title: String
    let value: String
    @ViewBuilder let control: Control

    init(_ title: String, value: String, @ViewBuilder control: () -> Control) {
        self.title = title
        self.value = value
        self.control = control()
    }

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(WorkspaceTheme.primaryText)
            Spacer()
            Text(value)
                .font(.system(size: 12))
                .foregroundStyle(WorkspaceTheme.secondaryText)
                .frame(minWidth: 42, alignment: .trailing)
            control
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

private struct SettingsDivider: View {
    var body: some View {
        Divider()
            .overlay(WorkspaceTheme.divider)
            .padding(.leading, 16)
    }
}
