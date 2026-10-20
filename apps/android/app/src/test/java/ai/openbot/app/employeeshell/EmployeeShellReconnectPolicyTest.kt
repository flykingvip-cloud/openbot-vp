package ai.openbot.app.employeeshell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 401 recovery policy tests (1.6-android). Pure JVM. */
class EmployeeShellReconnectPolicyTest {
  @Test
  fun mintUnauthorizedGoesToLogin() {
    val recovery = EmployeeShellReconnectPolicy.onBootstrapError(EmployeeShellUnauthorizedException(), priorAttempts = 0)
    assertEquals(EmployeeShellRecovery.Relogin, recovery)
  }

  @Test
  fun embed401RetriesSilentlyWithinBudget() {
    val error = IllegalStateException("employee shell session unauthorized (401)")
    val first = EmployeeShellReconnectPolicy.onBootstrapError(error, priorAttempts = 0)
    first as EmployeeShellRecovery.SilentReBootstrap
    assertEquals(1, first.attempt)
    assertTrue(first.delayMs > 0)

    val second = EmployeeShellReconnectPolicy.onBootstrapError(error, priorAttempts = 1)
    second as EmployeeShellRecovery.SilentReBootstrap
    assertEquals(2, second.attempt)
    assertTrue(second.delayMs >= first.delayMs)
  }

  @Test
  fun embed401ShowsOfflineAfterBudgetExhausted() {
    val error = IllegalStateException("boom")
    val recovery =
      EmployeeShellReconnectPolicy.onBootstrapError(error, priorAttempts = EmployeeShellReconnectPolicy.MAX_SILENT_ATTEMPTS)
    assertEquals(EmployeeShellRecovery.ShowOffline, recovery)
  }

  @Test
  fun transportLoadErrorShowsOffline() {
    assertEquals(EmployeeShellRecovery.ShowOffline, EmployeeShellReconnectPolicy.onLoadError())
  }

  @Test
  fun backoffIsCappedAtEightSeconds() {
    assertEquals(8_000L, EmployeeShellReconnectPolicy.backoffMs(100))
    assertTrue(EmployeeShellReconnectPolicy.backoffMs(1) <= 8_000L)
  }
}
