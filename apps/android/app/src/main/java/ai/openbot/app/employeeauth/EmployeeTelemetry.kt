package ai.openbot.app.employeeauth

//
// Employee-shell Wave 1 success metrics (task 1.11 / R-Matrix), instrumented on
// the Android side (task 1.9-android telemetry hooks).
//
// Thresholds (1.11): M-COLD <= 10s, M-TTI <= 3s, crash-free >= 99.5%, login
// success >= 98%. This is a thin sink the app wires to its analytics backend;
// crash-free is derived from the app's crash reporter (not emitted here). The
// default sink is a no-op so unit tests / unconfigured builds stay silent.
//
interface EmployeeTelemetry {
  /** M-COLD: process start -> first frame drawn, in milliseconds. */
  fun onColdStart(elapsedMs: Long)

  /** M-TTI: employee shell launch -> embed main frame loaded, in milliseconds. */
  fun onShellInteractive(elapsedMs: Long)

  /** Login success rate: one event per completed login/register attempt. */
  fun onLoginResult(success: Boolean)

  companion object {
    val NONE: EmployeeTelemetry = object : EmployeeTelemetry {
      override fun onColdStart(elapsedMs: Long) {}

      override fun onShellInteractive(elapsedMs: Long) {}

      override fun onLoginResult(success: Boolean) {}
    }

    /** Process-wide sink; the app assigns a real implementation at startup. */
    @Volatile
    var current: EmployeeTelemetry = NONE
  }
}
