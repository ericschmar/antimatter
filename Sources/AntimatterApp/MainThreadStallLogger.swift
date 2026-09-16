import AntimatterFoundation
import Foundation
import os

/// ponytail:diagnostic — temporary scroll-freeze instrumentation.
/// An off-main watchdog posts heartbeats to the main queue; when a heartbeat
/// is still pending after ~1 second the process is sampled with /usr/bin/sample
/// so the blocking stack is captured while the app is still frozen, and the
/// total stall duration is logged once the heartbeat finally executes. All
/// lines go to the 'freeze' log category; sample reports are written to the
/// temporary directory with antimatter-stall-*.txt names.
/// Remove this file (and its start call in AntimatterApp) once the
/// scroll-past-replies freeze is confirmed and fixed.
@MainActor
enum MainThreadStallLogger {
    private static var isStarted = false
    // Keeps the probe chain alive; the detector holds only weak self-references internally.
    private static var detector: StallDetector?

    static func start() {
        guard !isStarted else { return }
        isStarted = true
        // Startup line doubles as a sanity check that the running binary includes the diagnostics.
        AppLogger.freeze.notice("Freeze diagnostics armed: watchdog will sample the process during main-thread stalls")
        let detector = StallDetector()
        Self.detector = detector
        detector.beginProbing()
    }
}

private final class Heartbeat: @unchecked Sendable {
    private let arrived = OSAllocatedUnfairLock(initialState: false)
    private let birth = Date()

    var hasArrived: Bool {
        arrived.withLock { $0 }
    }

    /// Records arrival and returns how long the heartbeat waited in the main
    /// queue — an upper-bound measure of the main-thread stall.
    func arrive() -> TimeInterval {
        let wait = Date().timeIntervalSince(birth)
        arrived.withLock { $0 = true }
        return wait
    }
}

private final class StallDetector: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.antimatter.stall-watchdog", qos: .utility)

    func beginProbing() {
        beat()
    }

    private func beat() {
        let heartbeat = Heartbeat()
        DispatchQueue.main.async {
            let milliseconds = Int((heartbeat.arrive() * 1_000).rounded())
            if milliseconds > 1_000 {
                AppLogger.freeze.notice("Main Thread Stall: blocked approximately \(milliseconds) ms (see the most recent antimatter-stall-*.txt sample)")
            }
        }
        queue.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self else { return }
            if heartbeat.hasArrived {
                self.beat()
            } else {
                self.captureSample()
            }
        }
    }

    private func captureSample() {
        let pid = ProcessInfo.processInfo.processIdentifier
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("antimatter-stall-\(Int(Date().timeIntervalSince1970 * 1_000)).txt")
            .path
        AppLogger.freeze.notice("Main Thread Stall detected: sampling the process for 1 s, report at \(path, privacy: .public)")
        let sample = Process()
        sample.executableURL = URL(fileURLWithPath: "/usr/bin/sample")
        sample.arguments = [String(pid), "1", "-file", path]
        do {
            try sample.run()
            sample.waitUntilExit()
            AppLogger.freeze.notice("Main Thread Stall sample finished with exit \(sample.terminationStatus): \(path, privacy: .public)")
        } catch {
            AppLogger.freeze.notice("Main Thread Stall: automatic sampling failed (\(error.localizedDescription, privacy: .public)); run `/usr/bin/sample \(pid) 2` manually during the freeze instead")
        }
        beat()
    }
}
