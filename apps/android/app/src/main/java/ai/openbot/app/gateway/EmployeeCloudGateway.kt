package ai.openbot.app.gateway

import ai.openbot.app.account.AccountCookieJar
import ai.openbot.app.account.EmployeeSessionManager
import java.net.URI
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Manual WS target derived from an employee gateway base URL (or cloud defaults). */
data class ManualGatewayTarget(
  val host: String,
  val port: Int,
  val tls: Boolean,
)

/**
 * Resolve the manual gateway endpoint for an employee session.
 * Prefers the account gateway URL; falls back to [OpenBotCloudDefaults].
 */
fun resolveEmployeeManualGateway(gatewayBaseURL: String?): ManualGatewayTarget {
  val raw = gatewayBaseURL?.trim().orEmpty()
  if (raw.isNotEmpty()) {
    val uri = runCatching { URI(raw) }.getOrNull()
    val host = uri?.host?.trim()?.takeIf { it.isNotEmpty() }
    if (host != null) {
      val scheme = uri.scheme?.lowercase().orEmpty()
      val tls = scheme == "https" || scheme == "wss" || scheme.isEmpty()
      val port =
        when {
          uri.port > 0 -> uri.port
          tls -> 443
          else -> 80
        }
      return ManualGatewayTarget(host = host, port = port, tls = tls)
    }
  }
  return ManualGatewayTarget(
    host = OpenBotCloudDefaults.WS_HOST,
    port = OpenBotCloudDefaults.WS_PORT,
    tls = true,
  )
}

/** True when [host] is the public OpenBot cloud gateway (auto-trust / auto-pin). */
fun isOpenBotCloudGatewayHost(host: String): Boolean =
  host.trim().equals(OpenBotCloudDefaults.WS_HOST, ignoreCase = true)

/**
 * Copy the active employee AccountCookieJar cookies into [OpenBotHttp.cookieJar]
 * so Gateway WebSocket upgrades can present the platform-auth session (trusted-proxy).
 */
fun bridgeEmployeeCookiesIntoOpenBotHttp(session: EmployeeSessionManager) {
  val account = session.activeAccount() ?: return
  val jar = session.clientFor(account.accountId).cookieJar as? AccountCookieJar ?: return
  val cookies = jar.snapshot()
  if (cookies.isEmpty()) return
  val url = account.gatewayBaseURL.trim().toHttpUrlOrNull() ?: return
  OpenBotHttp.cookieJar.saveFromResponse(url, cookies)
}
