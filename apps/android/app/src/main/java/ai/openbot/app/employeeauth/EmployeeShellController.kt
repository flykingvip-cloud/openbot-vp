package ai.openbot.app.employeeauth

import ai.openbot.app.account.Account
import ai.openbot.app.account.AccountId
import ai.openbot.app.account.EmployeeSessionManager
import ai.openbot.app.deeplink.EmployeeDeepLinkParser
import ai.openbot.app.employeeshell.EmployeeDeepLinkRouter
import ai.openbot.app.employeeshell.EmployeeEmbedRouting
import ai.openbot.app.employeeshell.EmployeeShellBootstrap
import ai.openbot.app.employeeshell.EmployeeShellConfig
import ai.openbot.app.employeeshell.EmployeeShellIntent
import ai.openbot.app.employeeshell.EmployeeShellRouteAction
import ai.openbot.app.employeeshell.EmployeeShellRouteRequest
import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

//
// Employee shell controller — account + auth orchestration (task 1.4-android).
//
// Kotlin counterpart to apps/macos/.../EmployeeShellController.swift (auth slice).
// Bootstrap/WebView wiring (1.5), 401 handling (1.6) and deep-link routing (1.7)
// extend this same controller.
//
// Login uses the ACCOUNT'S isolated OkHttp client so the employee session cookie
// lands in that account's client session jar; the employee session is orthogonal
// to node pairing (contract §invariant 5 — never touched here).
//

/** Default cloud gateway. `gw.openbot.love` is a compatibility alias of www. */
const val DEFAULT_GATEWAY_BASE_URL = "https://www.openbot.love"

/** Outcome of an auth submission surfaced to the UI. */
sealed interface EmployeeAuthOutcome {
  data class LoggedIn(val account: Account) : EmployeeAuthOutcome

  data class Info(val message: String, val pendingResetCode: String? = null) : EmployeeAuthOutcome

  data class Error(val message: String) : EmployeeAuthOutcome
}

class EmployeeShellController(context: Context) {
  private val sessionManager = EmployeeSessionManager(context.applicationContext)

  val session: EmployeeSessionManager get() = sessionManager

  // Pending navigation the host consumes; a deep link stashed while signed out.
  private val navigationState = MutableStateFlow<EmployeeShellRouteRequest?>(null)
  val navigation: StateFlow<EmployeeShellRouteRequest?> = navigationState.asStateFlow()
  private var pendingRoute: EmployeeShellRouteRequest? = null

  fun isLoggedIn(): Boolean = sessionManager.activeAccount() != null

  fun accounts(): List<Account> = sessionManager.accounts()

  fun activeAccount(): Account? = sessionManager.activeAccount()

  fun switchAccount(accountId: String) = sessionManager.switchAccount(accountId)

  fun switchOrg(orgId: String?) {
    val account = sessionManager.activeAccount() ?: return
    sessionManager.switchOrg(account.accountId, orgId)
  }

  /** Password login into the account's isolated client jar; sets it active on success. */
  suspend fun login(gatewayBaseURL: String, email: String, password: String): EmployeeAuthOutcome {
    val account = Account.create(gatewayBaseURL, email)
    val client = sessionManager.clientFor(account.accountId)
    return when (val result = EmployeeAuthClient(account.gatewayBaseURL, client).login(email, password)) {
      is EmployeeAuthResult.Success -> {
        EmployeeTelemetry.current.onLoginResult(success = true)
        EmployeeAuthOutcome.LoggedIn(sessionManager.onLoggedIn(account, credential = null))
      }
      is EmployeeAuthResult.Failure -> {
        EmployeeTelemetry.current.onLoginResult(success = false)
        EmployeeAuthOutcome.Error(result.message)
      }
    }
  }

  /** Request a password reset email (always reports success to avoid account enumeration). */
  suspend fun forgotPassword(gatewayBaseURL: String, email: String): EmployeeAuthOutcome {
    val account = Account.create(gatewayBaseURL, email)
    val client = sessionManager.clientFor(account.accountId)
    return when (val result = EmployeeAuthClient(account.gatewayBaseURL, client).forgotPassword(email)) {
      is EmployeeAuthResult.Success ->
        EmployeeAuthOutcome.Info(message = "", pendingResetCode = result.pendingResetCode)
      is EmployeeAuthResult.Failure -> EmployeeAuthOutcome.Error(result.message)
    }
  }

  /**
   * Redeem a reset code and sign in. The platform-auth reset route creates a
   * session when the code is valid, same as Mac `PlatformAuthSessionStore.resetPassword`.
   */
  suspend fun resetPassword(
    gatewayBaseURL: String,
    email: String,
    password: String,
    code: String,
  ): EmployeeAuthOutcome {
    val account = Account.create(gatewayBaseURL, email)
    val client = sessionManager.clientFor(account.accountId)
    return when (
      val result =
        EmployeeAuthClient(account.gatewayBaseURL, client).resetPassword(email, code, password)
    ) {
      is EmployeeAuthResult.Success -> {
        EmployeeTelemetry.current.onLoginResult(success = true)
        EmployeeAuthOutcome.LoggedIn(sessionManager.onLoggedIn(account, credential = null))
      }
      is EmployeeAuthResult.Failure -> {
        EmployeeTelemetry.current.onLoginResult(success = false)
        EmployeeAuthOutcome.Error(result.message)
      }
    }
  }

  /** Accept an invitation + set a password; sets the account active on success. */
  suspend fun register(
    gatewayBaseURL: String,
    email: String,
    code: String,
    password: String,
    displayName: String?,
  ): EmployeeAuthOutcome {
    val account = Account.create(gatewayBaseURL, email)
    val client = sessionManager.clientFor(account.accountId)
    val result = EmployeeAuthClient(account.gatewayBaseURL, client).register(email, code, password, displayName)
    return when (result) {
      is EmployeeAuthResult.Success -> {
        EmployeeTelemetry.current.onLoginResult(success = true)
        EmployeeAuthOutcome.LoggedIn(sessionManager.onLoggedIn(account, credential = null))
      }
      is EmployeeAuthResult.Failure -> {
        EmployeeTelemetry.current.onLoginResult(success = false)
        EmployeeAuthOutcome.Error(result.message)
      }
    }
  }

  /** Log out the active account (server + local); leaves node pairing untouched. */
  suspend fun logoutActiveAccount() {
    val account = sessionManager.activeAccount() ?: return
    runCatching { EmployeeAuthClient(account.gatewayBaseURL, sessionManager.clientFor(account.accountId)).logout() }
    sessionManager.logout(account.accountId)
  }

  /**
   * Build the Employee Shell config for the active account: cloud/self-hosted
   * gateway base URL + a tokenProvider that mints bootstrap tokens with that
   * account's isolated client jar. Null when signed out.
   */
  fun shellConfig(initialTarget: String = EmployeeShellBootstrap.DEFAULT_TARGET): EmployeeShellConfig? {
    val account = sessionManager.activeAccount() ?: return null
    val client = sessionManager.clientFor(account.accountId)
    val gateway = AccountId.canonicalizeCloudGatewayUrl(account.gatewayBaseURL)
    return EmployeeShellConfig(
      gatewayBaseUrl = gateway,
      initialTarget = initialTarget,
      tokenProvider = { target -> EmployeeShellBootstrap.mintToken(gateway, client, target) },
    )
  }

  /** Map a decoded bridge intent to an embed navigation or a native host action. */
  fun routeIntent(intent: EmployeeShellIntent): EmployeeShellRouteAction = EmployeeEmbedRouting.action(intent)

  // ---- deep link routing (task 1.7) — auth-gated + account-scoped -----------

  /**
   * Parse + route an external / notification deep link (UNTRUSTED input). The
   * route resolves within the active account and is auth-gated: when signed out
   * the target is stashed and continued after a successful login (deferred deep
   * link). Returns true when the link was a recognized employee deep link.
   */
  fun handleDeepLink(uriString: String?): Boolean {
    val route = EmployeeDeepLinkParser.parse(uriString) ?: return false
    route(EmployeeDeepLinkRouter.toRouteRequest(route))
    return true
  }

  private fun route(request: EmployeeShellRouteRequest) {
    if (isLoggedIn()) {
      navigationState.value = request
    } else {
      // Deferred deep link: continue after login (never bypass auth).
      pendingRoute = request
    }
  }

  /** Continue a deferred deep link after a successful login. */
  fun consumePendingAfterLogin() {
    val request = pendingRoute ?: return
    pendingRoute = null
    navigationState.value = request
  }

  /** Host calls this after acting on the current navigation request. */
  fun clearNavigation() {
    navigationState.value = null
  }
}
