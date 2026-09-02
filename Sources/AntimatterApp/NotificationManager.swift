import AntimatterFoundation
import Foundation
import UserNotifications

@MainActor
final class NotificationManager: ObservableObject {
    private let center = UNUserNotificationCenter.current()

    func requestPermission() async {
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    }

    func notify(for event: MattermostWebSocketEvent) {
        guard event.event == "posted",
              let post = event.decodedData(MattermostPost.self, forKey: "post") else { return }
        let content = UNMutableNotificationContent()
        content.title = "New Mattermost message"
        content.body = post.message
        content.sound = .default
        content.userInfo = ["channelID": post.channelID]
        let request = UNNotificationRequest(identifier: post.id, content: content, trigger: nil)
        center.add(request)
    }
}
