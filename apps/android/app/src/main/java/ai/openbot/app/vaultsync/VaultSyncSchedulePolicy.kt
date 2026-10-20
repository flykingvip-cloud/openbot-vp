package ai.openbot.app.vaultsync

/** Sync scheduling policy (P3.2). Pure logic — no I/O. */
enum class VaultSyncLifecycleState {
  FOREGROUND,
  BACKGROUND,
}

enum class VaultSyncTrigger {
  LOCAL_CHANGE,
  APPEAR,
  MANUAL,
  BACKGROUND_OPPORTUNISTIC,
}

enum class VaultSyncDecision {
  RUN_IMMEDIATE,
  RUN_DEBOUNCED,
  SCHEDULE_BACKGROUND,
  SKIP,
}

data class VaultSyncScheduleInput(
  val lifecycle: VaultSyncLifecycleState,
  val trigger: VaultSyncTrigger,
  val isUnlocked: Boolean,
  val hasPendingLocalChanges: Boolean,
  val networkAvailable: Boolean,
  val lastSyncAtMs: Long?,
  val nowMs: Long,
)

object VaultSyncSchedulePolicy {
  const val FOREGROUND_DEBOUNCE_MS = 300L
  const val BACKGROUND_MIN_INTERVAL_MS = 15L * 60L * 1000L
  const val BACKGROUND_TIME_BUDGET_MS = 25_000L

  fun decide(input: VaultSyncScheduleInput): VaultSyncDecision {
    if (!input.networkAvailable) return VaultSyncDecision.SKIP
    if (!input.isUnlocked) return VaultSyncDecision.SKIP

    return when (input.lifecycle) {
      VaultSyncLifecycleState.FOREGROUND ->
        when (input.trigger) {
          VaultSyncTrigger.MANUAL,
          VaultSyncTrigger.APPEAR,
          -> VaultSyncDecision.RUN_IMMEDIATE
          VaultSyncTrigger.LOCAL_CHANGE ->
            if (input.hasPendingLocalChanges) {
              VaultSyncDecision.RUN_DEBOUNCED
            } else {
              VaultSyncDecision.SKIP
            }
          VaultSyncTrigger.BACKGROUND_OPPORTUNISTIC -> VaultSyncDecision.SKIP
        }
      VaultSyncLifecycleState.BACKGROUND ->
        when (input.trigger) {
          VaultSyncTrigger.MANUAL,
          VaultSyncTrigger.LOCAL_CHANGE,
          -> VaultSyncDecision.SCHEDULE_BACKGROUND
          VaultSyncTrigger.APPEAR -> VaultSyncDecision.SKIP
          VaultSyncTrigger.BACKGROUND_OPPORTUNISTIC -> {
            val last = input.lastSyncAtMs
            if (last != null && input.nowMs - last < BACKGROUND_MIN_INTERVAL_MS) {
              VaultSyncDecision.SKIP
            } else if (input.hasPendingLocalChanges || input.isUnlocked) {
              VaultSyncDecision.RUN_IMMEDIATE
            } else {
              VaultSyncDecision.SKIP
            }
          }
        }
    }
  }
}
