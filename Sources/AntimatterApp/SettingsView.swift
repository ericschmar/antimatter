import SwiftUI

struct SettingsView: View {
    let disconnect: () -> Void
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("compactTimeline") private var compactTimeline = true
    @AppStorage("showTimelineAvatars") private var showTimelineAvatars = true
    @AppStorage("messageFontSize") private var messageFontSize = 12.0
    @AppStorage("messageGroupingIntervalMinutes") private var messageGroupingIntervalMinutes = 5.0
    @AppStorage("followSystemAppearance") private var followSystemAppearance = false
    @AppStorage("workspaceOpenPreviews") private var openPreviews = true

    var body: some View {
        Form {
            Section("Notifications") {
                Toggle("Enable notifications", isOn: $notificationsEnabled)
            }
            Section("Appearance") {
                Toggle("Follow system appearance", isOn: $followSystemAppearance)
                Toggle("Use compact message timeline", isOn: $compactTimeline)
                Toggle("Show user avatars", isOn: $showTimelineAvatars)
                Stepper("Message font size: \(Int(messageFontSize)) pt", value: $messageFontSize, in: 10...20, step: 1)
                Stepper(
                    "Group consecutive messages within: \(Int(messageGroupingIntervalMinutes)) min",
                    value: $messageGroupingIntervalMinutes,
                    in: 0...60,
                    step: 1
                )
            }
            Section("Workspace") {
                Toggle("Open channels as previews", isOn: $openPreviews)
            }
            Section("Account") {
                Button("Disconnect", role: .destructive, action: disconnect)
            }
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 420, height: 320)
    }
}
