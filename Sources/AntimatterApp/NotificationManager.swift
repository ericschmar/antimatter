import AntimatterFoundation
import AppKit
import Foundation
import UserNotifications

@MainActor
final class NotificationManager: ObservableObject {
    private let center = UNUserNotificationCenter.current()
    private let defaults = UserDefaults.standard

    func requestPermission() async {
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    }

    func notify(for event: MattermostWebSocketEvent, currentUserID: String?) {
        guard event.event == "posted",
              let post = event.decodedData(MattermostPost.self, forKey: "post"),
              post.userID != currentUserID,
              notificationsAreEnabled,
              !NSApplication.shared.isActive else { return }
        let content = UNMutableNotificationContent()
        content.title = "New Mattermost message"
        content.body = post.message
        content.sound = notificationSoundsAreEnabled ? .default : nil
        content.userInfo = ["channelID": post.channelID]
        let request = UNNotificationRequest(identifier: post.id, content: content, trigger: nil)
        center.add(request)
    }

    private var notificationsAreEnabled: Bool {
        defaults.object(forKey: "notificationsEnabled") as? Bool ?? true
    }

    private var notificationSoundsAreEnabled: Bool {
        defaults.object(forKey: "notificationSoundsEnabled") as? Bool ?? true
    }
}
