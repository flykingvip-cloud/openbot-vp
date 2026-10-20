package ai.openbot.app.vaultsync

import org.junit.Assert.assertEquals
import org.junit.Test

class VaultSyncSchedulePolicyTest {
  @Test
  fun foregroundManualRunsImmediateWhenUnlocked() {
    assertEquals(
      VaultSyncDecision.RUN_IMMEDIATE,
      VaultSyncSchedulePolicy.decide(
        VaultSyncScheduleInput(
          lifecycle = VaultSyncLifecycleState.FOREGROUND,
          trigger = VaultSyncTrigger.MANUAL,
          isUnlocked = true,
          hasPendingLocalChanges = false,
          networkAvailable = true,
          lastSyncAtMs = null,
          nowMs = 1_000L,
        ),
      ),
    )
  }

  @Test
  fun skipsWhenLockedOrOffline() {
    assertEquals(
      VaultSyncDecision.SKIP,
      VaultSyncSchedulePolicy.decide(
        VaultSyncScheduleInput(
          lifecycle = VaultSyncLifecycleState.FOREGROUND,
          trigger = VaultSyncTrigger.MANUAL,
          isUnlocked = false,
          hasPendingLocalChanges = true,
          networkAvailable = true,
          lastSyncAtMs = null,
          nowMs = 1_000L,
        ),
      ),
    )
    assertEquals(
      VaultSyncDecision.SKIP,
      VaultSyncSchedulePolicy.decide(
        VaultSyncScheduleInput(
          lifecycle = VaultSyncLifecycleState.FOREGROUND,
          trigger = VaultSyncTrigger.MANUAL,
          isUnlocked = true,
          hasPendingLocalChanges = true,
          networkAvailable = false,
          lastSyncAtMs = null,
          nowMs = 1_000L,
        ),
      ),
    )
  }

  @Test
  fun backgroundOpportunisticRespectsMinInterval() {
    val now = 1_000_000L
    assertEquals(
      VaultSyncDecision.SKIP,
      VaultSyncSchedulePolicy.decide(
        VaultSyncScheduleInput(
          lifecycle = VaultSyncLifecycleState.BACKGROUND,
          trigger = VaultSyncTrigger.BACKGROUND_OPPORTUNISTIC,
          isUnlocked = true,
          hasPendingLocalChanges = true,
          networkAvailable = true,
          lastSyncAtMs = now - 60_000L,
          nowMs = now,
        ),
      ),
    )
    assertEquals(
      VaultSyncDecision.RUN_IMMEDIATE,
      VaultSyncSchedulePolicy.decide(
        VaultSyncScheduleInput(
          lifecycle = VaultSyncLifecycleState.BACKGROUND,
          trigger = VaultSyncTrigger.BACKGROUND_OPPORTUNISTIC,
          isUnlocked = true,
          hasPendingLocalChanges = true,
          networkAvailable = true,
          lastSyncAtMs = now - 20L * 60L * 1000L,
          nowMs = now,
        ),
      ),
    )
  }

  @Test
  fun backgroundLocalChangeSchedulesOnly() {
    assertEquals(
      VaultSyncDecision.SCHEDULE_BACKGROUND,
      VaultSyncSchedulePolicy.decide(
        VaultSyncScheduleInput(
          lifecycle = VaultSyncLifecycleState.BACKGROUND,
          trigger = VaultSyncTrigger.LOCAL_CHANGE,
          isUnlocked = true,
          hasPendingLocalChanges = true,
          networkAvailable = true,
          lastSyncAtMs = null,
          nowMs = 1_000L,
        ),
      ),
    )
  }
}
