package ai.openbot.app.employeeauth

import java.net.URI

//
// Pure login-form rules for the cold-start employee screen.
//
// Behavioral counterpart to apps/macos/.../PlatformAuth/PlatformAuthView.swift:
// login | register as the only segmented modes, gateway is not user-editable
// (cloud default only), and forgot → code → new password as inline modes
// (no third tab, no account switcher).
//

enum class EmployeeLoginMode {
  Login,
  Register,
  Forgot,
  Reset,
}

object EmployeeLoginForm {
  /** Employee apps never expose a gateway field; cloud default is used. */
  const val gatewayConfigRemovedForEmployees: Boolean = true

  fun showsSegmentedControl(mode: EmployeeLoginMode): Boolean = mode == EmployeeLoginMode.Login || mode == EmployeeLoginMode.Register

  fun showsPassword(mode: EmployeeLoginMode): Boolean = mode != EmployeeLoginMode.Forgot

  fun passwordIsNew(mode: EmployeeLoginMode): Boolean = mode == EmployeeLoginMode.Reset

  fun showsDisplayName(mode: EmployeeLoginMode): Boolean = mode == EmployeeLoginMode.Register

  fun showsInviteCode(mode: EmployeeLoginMode): Boolean = mode == EmployeeLoginMode.Register

  fun showsResetCode(mode: EmployeeLoginMode): Boolean = mode == EmployeeLoginMode.Reset

  fun showsForgotLink(mode: EmployeeLoginMode): Boolean = mode == EmployeeLoginMode.Login

  fun showsHaveCodeLink(mode: EmployeeLoginMode): Boolean = mode == EmployeeLoginMode.Forgot

  /** Forgot always continues into the reset screen, including when the request fails. */
  fun modeAfterForgotAttempt(mode: EmployeeLoginMode): EmployeeLoginMode =
    if (mode == EmployeeLoginMode.Forgot) EmployeeLoginMode.Reset else mode

  fun canSubmit(
    mode: EmployeeLoginMode,
    email: String,
    password: String,
    inviteCode: String,
    resetCode: String,
    gatewayValid: Boolean,
  ): Boolean {
    if (!gatewayValid) return false
    val emailOk = email.trim().isNotEmpty()
    return when (mode) {
      EmployeeLoginMode.Login -> emailOk && password.isNotEmpty()
      EmployeeLoginMode.Register ->
        emailOk && password.isNotEmpty() && inviteCode.trim().isNotEmpty()
      EmployeeLoginMode.Forgot -> emailOk
      EmployeeLoginMode.Reset ->
        emailOk && password.isNotEmpty() && resetCode.trim().isNotEmpty()
    }
  }

  fun forgotNotice(
    pendingResetCode: String?,
    sentMessage: String,
    devTemplate: String,
  ): String {
    val code = pendingResetCode?.trim().orEmpty()
    return if (code.isEmpty()) sentMessage else devTemplate.format(code)
  }

  fun isValidGateway(url: String): Boolean {
    val uri = runCatching { URI(url.trim()) }.getOrNull() ?: return false
    return !uri.scheme.isNullOrEmpty() && !uri.host.isNullOrEmpty()
  }
}
