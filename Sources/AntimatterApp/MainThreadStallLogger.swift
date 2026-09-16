import AntimatterFoundation
import Foundation

/// ponytail:diagnostic — temporary scroll-freeze instrumentation.
/// Continuously probes the main queue and logs any continuous stall over 750 ms
/// to the timeline log category so freezes can be correlated against the
/// "Image Attachment Decode" and "Published ..." events in the same stream.
/// Remove this file (and its start call in AntimatterApp) once the
/// scroll-past-replies freeze is confirmed and fixed.
@MainActor
enum MainThreadStallLogger {
    private static var isStarted = false

    static func start() {
        guard !isStarted else { return }
        isStarted = true
        scheduleNextProbe()
    }

    private static func scheduleNextProbe() {
        let due = Date().addingTimeInterval(0.25)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            let lagSeconds = Date().timeIntervalSince(due)
            if lagSeconds > 0.75 {
                AppLogger.timeline.emitEvent(
                    "Main Thread Stall",
                    "blocked main thread for approximately \(Int((lagSeconds * 1_000).rounded())) ms"
                )
            }
            scheduleNextProbe()
        }
    }
}
