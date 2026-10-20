package ai.openbot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class GatewayConfigResolverTest {
  @Test
  fun parseGatewayEndpointAcceptsWssUrl() {
    val parsed = parseGatewayEndpoint("wss://www.openbot.love:443")
    assertNotNull(parsed)
    assertEquals("www.openbot.love", parsed!!.host)
    assertEquals(443, parsed.port)
    assertEquals(true, parsed.tls)
  }

  @Test
  fun composeGatewayManualUrlBuildsHttps() {
    val url = composeGatewayManualUrl("www.openbot.love", "443", true)
    assertEquals("https://www.openbot.love:443", url)
  }

  @Test
  fun resolveGatewayConnectConfigManualOnly() {
    val config =
      resolveGatewayConnectConfig(
        manualHost = "10.0.2.2",
        manualPort = "18789",
        manualTls = false,
        fallbackToken = "token-1",
        fallbackPassword = "",
      )
    assertNotNull(config)
    assertEquals("10.0.2.2", config!!.host)
    assertEquals(18789, config.port)
    assertEquals(false, config.tls)
    assertEquals("token-1", config.token)
  }

  @Test
  fun resolveGatewayConnectConfigRejectsInvalidPort() {
    val config =
      resolveGatewayConnectConfig(
        manualHost = "localhost",
        manualPort = "not-a-port",
        manualTls = false,
        fallbackToken = "",
        fallbackPassword = "",
      )
    assertNull(config)
  }
}
