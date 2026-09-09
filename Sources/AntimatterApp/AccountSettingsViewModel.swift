import AntimatterFoundation
import Foundation
import SwiftUI

@MainActor
final class AccountSettingsViewModel: ObservableObject {
    @Published private(set) var profile: MattermostProfile?
    @Published private(set) var preferences: [MattermostPreference] = []
    @Published var firstName = ""
    @Published var lastName = ""
    @Published var nickname = ""
    @Published var username = ""
    @Published var email = ""
    @Published var status = "online"
    @Published var customStatus = ""
    @Published private(set) var avatarData: Data?
    @Published var errorMessage: String?
    @Published private(set) var isSaving = false

    private let settings: MattermostAccountSettings

    init(session: MattermostSession) {
        settings = MattermostAccountSettings(client: MattermostAPIClient(serverURL: session.serverURL, token: session.token))
    }

    func load() async {
        do {
            let profile = try await settings.loadProfile()
            self.profile = profile
            firstName = profile.firstName
            lastName = profile.lastName
            nickname = profile.nickname
            username = profile.username
            email = profile.email
            async let preferences = settings.loadNotificationPreferences(userID: profile.id)
            async let avatarData = settings.loadProfileImage(userID: profile.id)
            self.preferences = try await preferences
            self.avatarData = try? await avatarData
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func uploadAvatar(_ data: Data) async {
        guard let profile else { return }
        do {
            self.profile = try await settings.uploadProfileImage(data, userID: profile.id)
            avatarData = data
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func saveProfile() async {
        guard let profile else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            self.profile = try await settings.updateProfile(profile.id, patch: MattermostProfilePatch(
                email: email,
                username: username,
                firstName: firstName,
                lastName: lastName,
                nickname: nickname
            ))
            try await settings.updateStatus(status, userID: profile.id)
            try await settings.updateCustomStatus(MattermostCustomStatus(emoji: ":speech_balloon:", text: customStatus), userID: profile.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func notificationEnabled(_ name: String) -> Binding<Bool> {
        Binding(
            get: { self.preferences.first { $0.category == "notifications" && $0.name == name }?.value == "true" },
            set: { enabled in self.setNotification(name, enabled: enabled) }
        )
    }

    func channelNotificationLevel(_ channelID: String) -> Binding<String> {
        Binding(
            get: { self.preferences.first { $0.category == "channel" && $0.name == channelID }?.value ?? "default" },
            set: { level in self.setChannelNotification(channelID, level: level) }
        )
    }

    private func setChannelNotification(_ channelID: String, level: String) {
        guard let profile else { return }
        let preference = MattermostPreference(userID: profile.id, category: "channel", name: channelID, value: level)
        preferences.removeAll { $0.category == preference.category && $0.name == preference.name }
        preferences.append(preference)
        Task {
            do {
                _ = try await settings.saveNotificationPreferences([preference], userID: profile.id)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func setNotification(_ name: String, enabled: Bool) {
        guard let profile else { return }
        let preference = MattermostPreference(userID: profile.id, category: "notifications", name: name, value: enabled ? "true" : "false")
        preferences.removeAll { $0.category == preference.category && $0.name == preference.name }
        preferences.append(preference)
        Task {
            do {
                _ = try await settings.saveNotificationPreferences([preference], userID: profile.id)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
