package ai.openbot.app.ui

import androidx.core.net.toUri
import java.util.Locale

internal data class GatewayEndpointConfig(
  val host: String,
  val port: Int,
  val tls: Boolean,
  val displayUrl: String,
)

internal data class GatewayConnectConfig(
  val host: String,
  val port: Int,
  val tls: Boolean,
  val token: String,
  val password: String,
)

internal fun resolveGatewayConnectConfig(
  manualHost: String,
  manualPort: String,
  manualTls: Boolean,
  fallbackToken: String,
  fallbackPassword: String,
): GatewayConnectConfig? {
  val manualUrl = composeGatewayManualUrl(manualHost, manualPort, manualTls) ?: return null
  val parsed = parseGatewayEndpoint(manualUrl) ?: return null
  return GatewayConnectConfig(
    host = parsed.host,
    port = parsed.port,
    tls = parsed.tls,
    token = fallbackToken.trim(),
    password = fallbackPassword.trim(),
  )
}

internal fun parseGatewayEndpoint(rawInput: String): GatewayEndpointConfig? {
  val raw = rawInput.trim()
  if (raw.isEmpty()) return null

  val normalized = if (raw.contains("://")) raw else "https://$raw"
  val uri = normalized.toUri()
  val host = uri.host?.trim().orEmpty()
  if (host.isEmpty()) return null

  val scheme = uri.scheme?.trim()?.lowercase(Locale.US).orEmpty()
  val tls =
    when (scheme) {
      "ws", "http" -> false
      "wss", "https" -> true
      else -> true
    }
  val port =
    uri.port.takeIf { it in 1..65535 }
      ?: when {
        tls -> 443
        else -> 18789
      }
  val displayUrl = "${if (tls) "https" else "http"}://$host:$port"

  return GatewayEndpointConfig(host = host, port = port, tls = tls, displayUrl = displayUrl)
}

internal fun composeGatewayManualUrl(hostInput: String, portInput: String, tls: Boolean): String? {
  val host = hostInput.trim()
  val port = portInput.trim().toIntOrNull() ?: return null
  if (host.isEmpty() || port !in 1..65535) return null
  val scheme = if (tls) "https" else "http"
  return "$scheme://$host:$port"
}
