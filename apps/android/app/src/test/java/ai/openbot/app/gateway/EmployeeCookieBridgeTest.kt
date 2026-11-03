package ai.openbot.app.gateway

import ai.openbot.app.account.AccountCookieJar
import ai.openbot.app.account.NoopAccountCookiePersistence
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EmployeeCookieBridgeTest {
  @Test
  fun copiesAccountCookiesIntoOpenBotHttpJar() {
    CloudAuthClient.clearSession()
    val gatewayUrl = "https://www.openbot.love/".toHttpUrl()
    val accountJar = AccountCookieJar("acct-bridge", NoopAccountCookiePersistence)
    val cookie =
      Cookie.Builder()
        .name("openbot_session")
        .value("tok-123")
        .domain("www.openbot.love")
        .path("/")
        .secure()
        .httpOnly()
        .expiresAt(System.currentTimeMillis() + 86_400_000L)
        .build()
    accountJar.saveFromResponse(gatewayUrl, listOf(cookie))

    OpenBotHttp.cookieJar.saveFromResponse(gatewayUrl, accountJar.snapshot())
    val loaded = OpenBotHttp.cookieJar.loadForRequest(gatewayUrl)
    assertTrue(loaded.any { it.name == "openbot_session" && it.value == "tok-123" })
    assertEquals(1, loaded.count { it.name == "openbot_session" })
    CloudAuthClient.clearSession()
  }
}
