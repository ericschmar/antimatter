import AppKit
import SwiftUI

struct ProfileSettingsForm: View {
    @ObservedObject var model: AccountSettingsViewModel
    @State private var avatarImage: NSImage?

    var body: some View {
        SettingsGroup {
            HStack(spacing: 16) {
                ZStack(alignment: .bottomTrailing) {
                    Group {
                        if let avatarImage {
                            Image(nsImage: avatarImage).resizable().scaledToFill()
                        } else if let avatarData = model.avatarData, let image = NSImage(data: avatarData) {
                            Image(nsImage: image).resizable().scaledToFill()
                        } else {
                            Image(systemName: "person.fill").font(.system(size: 28)).foregroundStyle(WorkspaceTheme.secondaryText)
                        }
                    }
                    .frame(width: 72, height: 72)
                    .background(WorkspaceTheme.raisedSurface, in: Circle())
                    .clipShape(Circle())
                    Image(systemName: "camera.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(WorkspaceTheme.accent, in: Circle())
                        .overlay(Circle().stroke(WorkspaceTheme.surface, lineWidth: 2.5))
                }
                Button("Choose photo") {
                    let panel = NSOpenPanel()
                    panel.allowedContentTypes = [.image]
                    if panel.runModal() == .OK, let url = panel.url, let image = NSImage(contentsOf: url) {
                        avatarImage = image
                        if let data = image.tiffRepresentation {
                            Task { await model.uploadAvatar(data) }
                        }
                    }
                }
                Spacer()
            }
            .padding(16)
            SettingsDivider()
            ProfileField("First name", text: $model.firstName)
            SettingsDivider()
            ProfileField("Last name", text: $model.lastName)
            SettingsDivider()
            ProfileField("Nickname", text: $model.nickname)
            SettingsDivider()
            ProfileField("Username", text: $model.username)
            SettingsDivider()
            ProfileField("Email", text: $model.email)
            SettingsDivider()
            Picker("Status", selection: $model.status) {
                Text("Online").tag("online")
                Text("Away").tag("away")
                Text("Do not disturb").tag("dnd")
                Text("Offline").tag("offline")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            SettingsDivider()
            ProfileField("Custom status", text: $model.customStatus)
            HStack {
                Spacer()
                Button(model.isSaving ? "Saving…" : "Save profile") { Task { await model.saveProfile() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isSaving)
            }
            .padding(16)
        }
        if let errorMessage = model.errorMessage {
            Text(errorMessage).font(.system(size: 12)).foregroundStyle(WorkspaceTheme.attention)
        }
    }
}

private struct ProfileField: View {
    let title: String
    @Binding var text: String

    init(_ title: String, text: Binding<String>) {
        self.title = title
        _text = text
    }

    var body: some View {
        HStack {
            Text(title).font(.system(size: 13)).frame(width: 100, alignment: .leading)
            TextField(title, text: $text).textFieldStyle(.plain)
            Spacer(minLength: 0)
        }
        .foregroundStyle(WorkspaceTheme.primaryText)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
