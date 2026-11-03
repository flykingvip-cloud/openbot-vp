package ai.openbot.app.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EmployeeCloudGatewayTest {
  @Test
  fun resolveFallsBackToCloudDefaults() {
    val target = resolveEmployeeManualGateway(null)
    assertEquals(OpenBotCloudDefaults.WS_HOST, target.host)
    assertEquals(OpenBotCloudDefaults.WS_PORT, target.port)
    assertTrue(target.tls)
  }

  @Test
  fun resolveParsesHttpsGatewayUrl() {
    val target = resolveEmployeeManualGateway("https://www.openbot.love/path")
    assertEquals("www.openbot.love", target.host)
    assertEquals(443, target.port)
    assertTrue(target.tls)
  }

  @Test
  fun resolveParsesExplicitPort() {
    val target = resolveEmployeeManualGateway("https://gw.example.com:8443")
    assertEquals("gw.example.com", target.host)
    assertEquals(8443, target.port)
    assertTrue(target.tls)
  }

  @Test
  fun cloudHostDetector() {
    assertTrue(isOpenBotCloudGatewayHost("www.openbot.love"))
    assertTrue(isOpenBotCloudGatewayHost("WWW.OpenBot.Love"))
    assertFalse(isOpenBotCloudGatewayHost("gw.example.com"))
  }
}

class GatewayReconnectCloudTest {
  @Test
  fun allowsCloudManualWithoutTlsPin() {
    val got =
      resolveTrustedReconnectEndpoint(
        manualEnabled = true,
        manualHost = OpenBotCloudDefaults.WS_HOST,
        manualPort = OpenBotCloudDefaults.WS_PORT,
        manualTls = true,
        lastDiscoveredStableId = "",
        gateways = emptyList(),
        hasStoredTlsPin = { false },
      )
    assertEquals(GatewayEndpoint.manual(OpenBotCloudDefaults.WS_HOST, OpenBotCloudDefaults.WS_PORT), got)
  }

  @Test
  fun stillRejectsUnknownManualWithoutPin() {
    val got =
      resolveTrustedReconnectEndpoint(
        manualEnabled = true,
        manualHost = "gw.example.com",
        manualPort = 18789,
        manualTls = true,
        lastDiscoveredStableId = "",
        gateways = emptyList(),
        hasStoredTlsPin = { false },
      )
    assertEquals(null, got)
  }
}
