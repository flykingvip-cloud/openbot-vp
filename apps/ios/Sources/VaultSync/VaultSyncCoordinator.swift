import Foundation

protocol VaultSyncRunning: AnyObject, Sendable {
    func runSync(trigger: VaultSyncTrigger) async -> VaultSyncRunResult
}

struct VaultSyncRunResult: Sendable, Equatable {
    var ok: Bool
    var uploaded: Int
    var downloaded: Int
    var message: String?

    static let skipped = VaultSyncRunResult(ok: true, uploaded: 0, downloaded: 0, message: "skipped")
}

/// Coordinates foreground-immediate vs background-opportunistic vault sync (P3.2).
@MainActor
final class VaultSyncCoordinator {
    static let shared = VaultSyncCoordinator()

    private(set) var lifecycle: VaultSyncLifecycleState = .foreground
    private(set) var lastSyncAt: Date?
    private(set) var lastDecision: VaultSyncDecision?
    var isUnlocked: Bool = false
    var hasPendingLocalChanges: Bool = false
    var networkAvailable: Bool = true
    var runner: VaultSyncRunning?

    private var debounceTask: Task<Void, Never>?
    private var backgroundTask: Task<Void, Never>?

    func setLifecycle(_ lifecycle: VaultSyncLifecycleState) {
        self.lifecycle = lifecycle
        if lifecycle == .background {
            VaultSyncBackgroundRefresh.schedule(afterSeconds: 120, reason: "lifecycle_background")
            _ = self.requestSync(trigger: .localChange)
        } else if lifecycle == .foreground {
            _ = self.requestSync(trigger: .appear)
        }
    }

    @discardableResult
    func requestSync(trigger: VaultSyncTrigger, now: Date = Date()) -> VaultSyncDecision {
        let input = VaultSyncScheduleInput(
            lifecycle: self.lifecycle,
            trigger: trigger,
            isUnlocked: self.isUnlocked,
            hasPendingLocalChanges: self.hasPendingLocalChanges,
            networkAvailable: self.networkAvailable,
            lastSyncAt: self.lastSyncAt,
            now: now
        )
        let decision = VaultSyncSchedulePolicy.decide(input)
        self.lastDecision = decision
        switch decision {
        case .skip:
            break
        case .runImmediate:
            self.startRun(trigger: trigger)
        case .runDebounced:
            self.debounceTask?.cancel()
            self.debounceTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(VaultSyncSchedulePolicy.foregroundDebounceSeconds * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self.startRun(trigger: trigger)
            }
        case .scheduleBackground:
            VaultSyncBackgroundRefresh.schedule(afterSeconds: 90, reason: "pending_changes")
        }
        return decision
    }

    /// Invoked from BGAppRefresh — opportunistic, budget-limited.
    func handleBackgroundRefreshWake() async -> Bool {
        self.lifecycle = .background
        let decision = self.requestSync(trigger: .backgroundOpportunistic)
        guard decision == .runImmediate else { return false }
        // Wait briefly for in-flight run started by requestSync.
        try? await Task.sleep(nanoseconds: 50_000_000)
        return self.lastSyncAt != nil
    }

    private func startRun(trigger: VaultSyncTrigger) {
        self.backgroundTask?.cancel()
        self.backgroundTask = Task { @MainActor in
            guard let runner = self.runner else {
                // No runner wired yet — schedule probe only; do not report success.
                return
            }
            let result = await runner.runSync(trigger: trigger)
            if result.ok {
                self.lastSyncAt = Date()
                if trigger == .localChange || result.uploaded > 0 {
                    self.hasPendingLocalChanges = false
                }
            }
        }
    }
}
