package ai.openbot.app.gateway

/**
 * Resolve a reconnect target when there is no in-memory connected endpoint.
 * Trust rules match autoconnect: stored TLS pin required for manual / lastDiscovered,
 * except the known public cloud host (same auto-pin path as [NodeRuntime.connect]).
 */
internal fun resolveTrustedReconnectEndpoint(
  manualEnabled: Boolean,
  manualHost: String,
  manualPort: Int,
  manualTls: Boolean,
  lastDiscoveredStableId: String,
  gateways: List<GatewayEndpoint>,
  hasStoredTlsPin: (stableId: String) -> Boolean,
): GatewayEndpoint? {
  if (manualEnabled) {
    val host = manualHost.trim()
    if (host.isNotEmpty() && manualPort in 1..65535 && manualTls) {
      val endpoint = GatewayEndpoint.manual(host = host, port = manualPort)
      if (isOpenBotCloudGatewayHost(host) || hasStoredTlsPin(endpoint.stableId)) {
        return endpoint
      }
    }
  }

  val targetStableId = lastDiscoveredStableId.trim()
  if (targetStableId.isEmpty()) return null
  val target = gateways.firstOrNull { it.stableId == targetStableId } ?: return null
  if (!hasStoredTlsPin(target.stableId)) return null
  return target
}
