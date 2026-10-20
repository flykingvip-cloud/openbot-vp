package ai.openbot.app.vaultsync

import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class VaultSyncRunResult(
  val ok: Boolean,
  val uploaded: Int = 0,
  val downloaded: Int = 0,
  val message: String? = null,
)

fun interface VaultSyncRunning {
  suspend fun runSync(trigger: VaultSyncTrigger): VaultSyncRunResult
}

/**
 * Coordinates foreground-immediate vs background-opportunistic vault sync (P3.2).
 * Background work uses WorkManager constraints; no permanent real-time promise.
 */
class VaultSyncCoordinator(
  private val scope: CoroutineScope = CoroutineScope(Dispatchers.Main.immediate),
  private val scheduleBackground: () -> Unit = {},
  private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
  @Volatile
  var lifecycle: VaultSyncLifecycleState = VaultSyncLifecycleState.FOREGROUND

  @Volatile
  var isUnlocked: Boolean = false

  @Volatile
  var hasPendingLocalChanges: Boolean = false

  @Volatile
  var networkAvailable: Boolean = true

  @Volatile
  var lastSyncAtMs: Long? = null

  @Volatile
  var lastDecision: VaultSyncDecision? = null

  var runner: VaultSyncRunning? = null

  private var debounceJob: Job? = null
  private var runJob: Job? = null

  fun applyLifecycle(next: VaultSyncLifecycleState) {
    lifecycle = next
    if (next == VaultSyncLifecycleState.BACKGROUND) {
      scheduleBackground()
      requestSync(VaultSyncTrigger.LOCAL_CHANGE)
    } else {
      requestSync(VaultSyncTrigger.APPEAR)
    }
  }

  fun requestSync(trigger: VaultSyncTrigger): VaultSyncDecision {
    val input =
      VaultSyncScheduleInput(
        lifecycle = lifecycle,
        trigger = trigger,
        isUnlocked = isUnlocked,
        hasPendingLocalChanges = hasPendingLocalChanges,
        networkAvailable = networkAvailable,
        lastSyncAtMs = lastSyncAtMs,
        nowMs = nowMs(),
      )
    val decision = VaultSyncSchedulePolicy.decide(input)
    lastDecision = decision
    when (decision) {
      VaultSyncDecision.SKIP -> Unit
      VaultSyncDecision.RUN_IMMEDIATE -> startRun(trigger)
      VaultSyncDecision.RUN_DEBOUNCED -> {
        debounceJob?.cancel()
        debounceJob =
          scope.launch {
            delay(VaultSyncSchedulePolicy.FOREGROUND_DEBOUNCE_MS)
            startRun(trigger)
          }
      }
      VaultSyncDecision.SCHEDULE_BACKGROUND -> scheduleBackground()
    }
    return decision
  }

  fun handleBackgroundOpportunistic(): Boolean {
    lifecycle = VaultSyncLifecycleState.BACKGROUND
    val decision = requestSync(VaultSyncTrigger.BACKGROUND_OPPORTUNISTIC)
    return decision == VaultSyncDecision.RUN_IMMEDIATE
  }

  private fun startRun(trigger: VaultSyncTrigger) {
    runJob?.cancel()
    runJob =
      scope.launch {
        val currentRunner = runner
        if (currentRunner == null) {
          return@launch
        }
        val result = currentRunner.runSync(trigger)
        if (result.ok) {
          lastSyncAtMs = nowMs()
          if (trigger == VaultSyncTrigger.LOCAL_CHANGE || result.uploaded > 0) {
            hasPendingLocalChanges = false
          }
        }
      }
  }

  companion object {
    val shared = AtomicReference(VaultSyncCoordinator())

    fun get(): VaultSyncCoordinator = shared.get()

    fun replaceForTests(coordinator: VaultSyncCoordinator) {
      shared.set(coordinator)
    }
  }
}

object VaultSyncBackgroundScheduler {
  const val UNIQUE_WORK_NAME = VaultSyncConstants.BACKGROUND_WORK_NAME

  fun enqueue(context: Context, delaySeconds: Long = 90) {
    val constraints =
      Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .setRequiresBatteryNotLow(true)
        .build()
    val request =
      OneTimeWorkRequestBuilder<VaultSyncBackgroundWorker>()
        .setConstraints(constraints)
        .setInitialDelay(delaySeconds.coerceAtLeast(60), TimeUnit.SECONDS)
        .addTag("vault-sync")
        .build()
    WorkManager.getInstance(context.applicationContext)
      .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, request)
  }
}

class VaultSyncBackgroundWorker(
  appContext: Context,
  params: WorkerParameters,
) : Worker(appContext, params) {
  override fun doWork(): Result {
    val started = VaultSyncCoordinator.get().handleBackgroundOpportunistic()
    // Always re-arm a later opportunistic window; OS decides when it runs.
    VaultSyncBackgroundScheduler.enqueue(
      applicationContext,
      delaySeconds = VaultSyncSchedulePolicy.BACKGROUND_MIN_INTERVAL_MS / 1000,
    )
    return if (started) Result.success() else Result.success()
  }
}

/** Process-lifecycle bridge — foreground immediate / background schedule. */
object VaultSyncLifecycle {
  private var installed = false

  fun install(context: Context) {
    if (installed) return
    installed = true
    val appContext = context.applicationContext
    VaultSyncCoordinator.replaceForTests(
      VaultSyncCoordinator(
        scheduleBackground = { VaultSyncBackgroundScheduler.enqueue(appContext) },
      ),
    )
    ProcessLifecycleOwner.get().lifecycle.addObserver(
      object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
          VaultSyncCoordinator.get().applyLifecycle(VaultSyncLifecycleState.FOREGROUND)
        }

        override fun onStop(owner: LifecycleOwner) {
          VaultSyncCoordinator.get().applyLifecycle(VaultSyncLifecycleState.BACKGROUND)
        }
      },
    )
  }
}
