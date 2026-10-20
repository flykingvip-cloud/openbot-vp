import Foundation

/// Sync scheduling policy (P3.2). Pure logic — no I/O.
/// Background sync is opportunistic; never promised as permanent real-time.
enum VaultSyncLifecycleState: String, Sendable {
    case foreground
    case background
}

enum VaultSyncTrigger: String, Sendable {
    case localChange
    case appear
    case manual
    case backgroundOpportunistic
}

enum VaultSyncDecision: String, Equatable, Sendable {
    case runImmediate
    case runDebounced
    case scheduleBackground
    case skip
}

struct VaultSyncScheduleInput: Sendable {
    var lifecycle: VaultSyncLifecycleState
    var trigger: VaultSyncTrigger
    var isUnlocked: Bool
    var hasPendingLocalChanges: Bool
    var networkAvailable: Bool
    var lastSyncAt: Date?
    var now: Date
}

enum VaultSyncSchedulePolicy {
    static let foregroundDebounceSeconds: TimeInterval = 0.3
    /// OS may delay BGAppRefresh; we also avoid hammering.
    static let backgroundMinIntervalSeconds: TimeInterval = 15 * 60
    /// Soft budget for a single background pass (iOS BGAppRefresh ~30s).
    static let backgroundTimeBudgetSeconds: TimeInterval = 25

    static func decide(_ input: VaultSyncScheduleInput) -> VaultSyncDecision {
        if !input.networkAvailable {
            return .skip
        }
        if !input.isUnlocked {
            return .skip
        }

        switch input.lifecycle {
        case .foreground:
            switch input.trigger {
            case .manual, .appear:
                return .runImmediate
            case .localChange:
                return input.hasPendingLocalChanges ? .runDebounced : .skip
            case .backgroundOpportunistic:
                // Foreground ignores background-only triggers.
                return .skip
            }
        case .background:
            switch input.trigger {
            case .manual:
                // Manual while backgrounded: schedule opportunistic work.
                return .scheduleBackground
            case .localChange:
                return .scheduleBackground
            case .appear:
                return .skip
            case .backgroundOpportunistic:
                if let last = input.lastSyncAt,
                   input.now.timeIntervalSince(last) < self.backgroundMinIntervalSeconds
                {
                    return .skip
                }
                return input.hasPendingLocalChanges || input.isUnlocked ? .runImmediate : .skip
            }
        }
    }
}
