import Foundation
import Testing
@testable import OpenBot

@Suite struct VaultSyncSchedulePolicyTests {
    @Test func foregroundManualRunsImmediateWhenUnlocked() {
        let decision = VaultSyncSchedulePolicy.decide(
            VaultSyncScheduleInput(
                lifecycle: .foreground,
                trigger: .manual,
                isUnlocked: true,
                hasPendingLocalChanges: false,
                networkAvailable: true,
                lastSyncAt: nil,
                now: Date()
            )
        )
        #expect(decision == .runImmediate)
    }

    @Test func skipsWhenLockedOrOffline() {
        #expect(
            VaultSyncSchedulePolicy.decide(
                VaultSyncScheduleInput(
                    lifecycle: .foreground,
                    trigger: .manual,
                    isUnlocked: false,
                    hasPendingLocalChanges: true,
                    networkAvailable: true,
                    lastSyncAt: nil,
                    now: Date()
                )
            ) == .skip
        )
        #expect(
            VaultSyncSchedulePolicy.decide(
                VaultSyncScheduleInput(
                    lifecycle: .foreground,
                    trigger: .manual,
                    isUnlocked: true,
                    hasPendingLocalChanges: true,
                    networkAvailable: false,
                    lastSyncAt: nil,
                    now: Date()
                )
            ) == .skip
        )
    }

    @Test func backgroundOpportunisticRespectsMinInterval() {
        let now = Date()
        let recent = now.addingTimeInterval(-60)
        #expect(
            VaultSyncSchedulePolicy.decide(
                VaultSyncScheduleInput(
                    lifecycle: .background,
                    trigger: .backgroundOpportunistic,
                    isUnlocked: true,
                    hasPendingLocalChanges: true,
                    networkAvailable: true,
                    lastSyncAt: recent,
                    now: now
                )
            ) == .skip
        )
        #expect(
            VaultSyncSchedulePolicy.decide(
                VaultSyncScheduleInput(
                    lifecycle: .background,
                    trigger: .backgroundOpportunistic,
                    isUnlocked: true,
                    hasPendingLocalChanges: true,
                    networkAvailable: true,
                    lastSyncAt: now.addingTimeInterval(-20 * 60),
                    now: now
                )
            ) == .runImmediate
        )
    }

    @Test func backgroundLocalChangeSchedulesOnly() {
        #expect(
            VaultSyncSchedulePolicy.decide(
                VaultSyncScheduleInput(
                    lifecycle: .background,
                    trigger: .localChange,
                    isUnlocked: true,
                    hasPendingLocalChanges: true,
                    networkAvailable: true,
                    lastSyncAt: nil,
                    now: Date()
                )
            ) == .scheduleBackground
        )
    }
}
