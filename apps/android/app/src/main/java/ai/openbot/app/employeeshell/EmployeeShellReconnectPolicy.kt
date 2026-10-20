package ai.openbot.app.employeeshell

import kotlin.math.pow

//
// 401 / session-invalidation recovery policy (task 1.6-android). Pure + testable.
//
// Distinguishes the two 401 sources from account-session-model.md §Bootstrap:
//   - embed main-frame 401  -> the HttpOnly employee session lapsed: SILENTLY
//     re-bootstrap (re-mint with the account client jar) up to a small budget,
//     with exponential backoff, before surfacing an offline placeholder.
//   - mint 401              -> the login session itself is gone: go back to login.
// Transport failures (offline / DNS / TLS) surface the offline placeholder.
//
// Mirrors the macOS controller.onSessionUnauthorized behavior; the backoff curve
// matches GatewaySession (350ms * 1.7^attempt, capped at 8s).
//

sealed interface EmployeeShellRecovery {
  /** Login session is gone (mint 401): present login. */
  data object Relogin : EmployeeShellRecovery

  /** Session lapsed: re-mint + reload after [delayMs] (this is [attempt] of the budget). */
  data class SilentReBootstrap(val attempt: Int, val delayMs: Long) : EmployeeShellRecovery

  /** Recovery budget exhausted or transport failure: show the offline placeholder. */
  data object ShowOffline : EmployeeShellRecovery
}

object EmployeeShellReconnectPolicy {
  const val MAX_SILENT_ATTEMPTS = 3

  /** Decide recovery for a bootstrap/embed error given how many silent tries already ran. */
  fun onBootstrapError(error: Throwable, priorAttempts: Int): EmployeeShellRecovery {
    if (error is EmployeeShellUnauthorizedException) return EmployeeShellRecovery.Relogin
    if (priorAttempts < MAX_SILENT_ATTEMPTS) {
      val attempt = priorAttempts + 1
      return EmployeeShellRecovery.SilentReBootstrap(attempt = attempt, delayMs = backoffMs(attempt))
    }
    return EmployeeShellRecovery.ShowOffline
  }

  /** Transport-level load failures always surface the placeholder (no silent retry loop). */
  fun onLoadError(): EmployeeShellRecovery = EmployeeShellRecovery.ShowOffline

  /** Exponential backoff in ms, capped at 8s (matches GatewaySession). */
  fun backoffMs(attempt: Int): Long = minOf(8_000L, (350.0 * 1.7.pow(attempt)).toLong())
}
