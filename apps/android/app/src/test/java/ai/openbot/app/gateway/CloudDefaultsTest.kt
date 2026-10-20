package ai.openbot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ai.openbot.app.gateway.OpenBotCloudDefaults

class CloudDefaultsTest {
  @Test
  fun cloudDefaultsPointAtProductionEmployeeHost() {
    assertEquals("https://www.openbot.love", OpenBotCloudDefaults.BASE_URL)
    assertEquals("www.openbot.love", OpenBotCloudDefaults.WS_HOST)
    assertEquals(443, OpenBotCloudDefaults.WS_PORT)
    assertTrue(OpenBotCloudDefaults.PLATFORM_AUTH_LOGIN_PATH.startsWith("/__openbot/platform-auth"))
    assertTrue(OpenBotCloudDefaults.PLATFORM_AUTH_REGISTER_PATH.contains("/employee/register"))
    assertTrue(OpenBotCloudDefaults.PLATFORM_AUTH_FORGOT_PATH.contains("/password/forgot"))
    assertTrue(OpenBotCloudDefaults.PLATFORM_AUTH_RESET_PATH.contains("/password/reset"))
  }
}
