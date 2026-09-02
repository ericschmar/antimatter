import SwiftUI

struct SettingsView: View {
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("compactTimeline") private var compactTimeline = true
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
            }
            Section("Workspace") {
                Toggle("Open channels as previews", isOn: $openPreviews)
            }
        }
        .formStyle(.grouped)
        .padding()
        .frame(width: 420, height: 320)
    }
}
