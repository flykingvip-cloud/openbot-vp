import BackgroundTasks
import Foundation
import os

/// BGAppRefresh for vault sync — opportunistic only; not permanent real-time.
enum VaultSyncBackgroundRefresh {
    static let taskIdentifier = "ai.openbot.ios.vault-sync.refresh"
    private static let logger = Logger(subsystem: "ai.openbot.ios", category: "VaultSyncBackground")

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: self.taskIdentifier, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.handle(task: refresh)
        }
    }

    static func schedule(afterSeconds delay: TimeInterval, reason: String) {
        let request = BGAppRefreshTaskRequest(identifier: self.taskIdentifier)
        request.earliestBeginDate = Date().addingTimeInterval(max(60, delay))
        do {
            try BGTaskScheduler.shared.submit(request)
            self.logger.info("Scheduled vault-sync BG refresh reason=\(reason, privacy: .public)")
        } catch {
            self.logger.error(
                "Failed vault-sync BG schedule reason=\(reason, privacy: .public) error=\(error.localizedDescription, privacy: .public)"
            )
        }
    }

    private static func handle(task: BGAppRefreshTask) {
        // Reschedule next opportunistic window; OS decides actual fire time.
        self.schedule(afterSeconds: VaultSyncSchedulePolicy.backgroundMinIntervalSeconds, reason: "reschedule")
        let work = Task { @MainActor in
            await VaultSyncCoordinator.shared.handleBackgroundRefreshWake()
        }
        // BGAppRefreshTask is not Sendable. Keep the caller's use on the expiration
        // handler and hop completion through an unchecked box so the Task does not
        // capture the same non-Sendable value.
        let completion = VaultSyncRefreshTaskBox(task)
        task.expirationHandler = {
            work.cancel()
        }
        Task {
            let ok = await work.value
            completion.task.setTaskCompleted(success: ok)
        }
    }
}

/// BG task handle shared with a completion `Task` without pretending the SDK type is Sendable.
private final class VaultSyncRefreshTaskBox: @unchecked Sendable {
    let task: BGAppRefreshTask

    init(_ task: BGAppRefreshTask) {
        self.task = task
    }
}
