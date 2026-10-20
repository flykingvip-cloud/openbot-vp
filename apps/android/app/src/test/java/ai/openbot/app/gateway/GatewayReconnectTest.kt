package ai.openbot.app.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GatewayReconnectTest {
  private val discovered =
    GatewayEndpoint(
      stableId = "mdns|office-gw",
      name = "office-gw",
      host = "192.168.1.10",
      port = 18789,
    )

  @Test
  fun prefersTrustedManualWhenEnabled() {
    val manual = GatewayEndpoint.manual(host = "gw.example.com", port = 18789)
    val pins = setOf(manual.stableId)
    val got =
      resolveTrustedReconnectEndpoint(
        manualEnabled = true,
        manualHost = "gw.example.com",
        manualPort = 18789,
        manualTls = true,
        lastDiscoveredStableId = discovered.stableId,
        gateways = listOf(discovered),
        hasStoredTlsPin = { it in pins },
      )
    assertEquals(manual, got)
  }

  @Test
  fun rejectsManualWithoutTlsPin() {
    val got =
      resolveTrustedReconnectEndpoint(
        manualEnabled = true,
        manualHost = "gw.example.com",
        manualPort = 18789,
        manualTls = true,
        lastDiscoveredStableId = discovered.stableId,
        gateways = listOf(discovered),
        hasStoredTlsPin = { false },
      )
    assertNull(got)
  }

  @Test
  fun usesLastDiscoveredWithStoredPin() {
    val pins = setOf(discovered.stableId)
    val got =
      resolveTrustedReconnectEndpoint(
        manualEnabled = false,
        manualHost = "",
        manualPort = 18789,
        manualTls = true,
        lastDiscoveredStableId = discovered.stableId,
        gateways = listOf(discovered),
        hasStoredTlsPin = { it in pins },
      )
    assertEquals(discovered, got)
  }

  @Test
  fun rejectsLastDiscoveredWithoutPin() {
    val got =
      resolveTrustedReconnectEndpoint(
        manualEnabled = false,
        manualHost = "",
        manualPort = 18789,
        manualTls = true,
        lastDiscoveredStableId = discovered.stableId,
        gateways = listOf(discovered),
        hasStoredTlsPin = { false },
      )
    assertNull(got)
  }
}
