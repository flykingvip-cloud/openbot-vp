package ai.openbot.app.account

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Per-account cookie jar tests (1.3-android). Pure JVM (OkHttp is a JVM lib):
 * verifies domain scoping, cross-account isolation, persistence round-trip, and
 * that session cookies stay volatile.
 */
class AccountCookieJarTest {
  private class FakePersistence : AccountCookiePersistence {
    val data = HashMap<String, List<String>>()

    override fun load(accountId: String): List<String> = data[accountId] ?: emptyList()

    override fun save(accountId: String, serialized: List<String>) {
      data[accountId] = serialized
    }

    override fun clear(accountId: String) {
      data.remove(accountId)
    }
  }

  private val gatewayUrl = "https://gw.openbot.love/native/bootstrap/mint".toHttpUrl()
  private val otherHostUrl = "https://gw.other.host/".toHttpUrl()

  private fun persistentCookie(name: String = "session", value: String = "abc"): Cookie =
    Cookie.Builder()
      .name(name)
      .value(value)
      .domain("gw.openbot.love")
      .path("/")
      .expiresAt(System.currentTimeMillis() + 3_600_000)
      .secure()
      .httpOnly()
      .build()

  @Test
  fun cookiesAreScopedToMatchingHost() {
    val jar = AccountCookieJar("acct-a")
    jar.saveFromResponse(gatewayUrl, listOf(persistentCookie()))

    assertEquals(1, jar.loadForRequest(gatewayUrl).size)
    assertTrue(jar.loadForRequest(otherHostUrl).isEmpty())
  }

  @Test
  fun accountsDoNotShareCookies() {
    val persistence = FakePersistence()
    val jarA = AccountCookieJar("acct-a", persistence)
    val jarB = AccountCookieJar("acct-b", persistence)

    jarA.saveFromResponse(gatewayUrl, listOf(persistentCookie(value = "a-token")))

    // A different account's jar never sees account A's login cookie.
    assertTrue(jarB.loadForRequest(gatewayUrl).isEmpty())
    assertTrue(jarB.snapshot().isEmpty())
    assertEquals("a-token", jarA.loadForRequest(gatewayUrl).single().value)
  }

  @Test
  fun persistentCookiesSurviveNewJarInstance() {
    val persistence = FakePersistence()
    AccountCookieJar("acct-a", persistence)
      .saveFromResponse(gatewayUrl, listOf(persistentCookie(value = "restored")))

    val reopened = AccountCookieJar("acct-a", persistence)
    assertEquals("restored", reopened.loadForRequest(gatewayUrl).single().value)
  }

  @Test
  fun sessionCookiesAreNotPersisted() {
    val persistence = FakePersistence()
    val sessionCookie =
      Cookie.Builder().name("s").value("v").domain("gw.openbot.love").path("/").build()

    AccountCookieJar("acct-a", persistence).saveFromResponse(gatewayUrl, listOf(sessionCookie))

    val reopened = AccountCookieJar("acct-a", persistence)
    assertTrue(reopened.loadForRequest(gatewayUrl).isEmpty())
  }

  @Test
  fun clearWipesAccountCookies() {
    val persistence = FakePersistence()
    val jar = AccountCookieJar("acct-a", persistence)
    jar.saveFromResponse(gatewayUrl, listOf(persistentCookie()))

    jar.clear()

    assertTrue(jar.loadForRequest(gatewayUrl).isEmpty())
    assertTrue(AccountCookieJar("acct-a", persistence).loadForRequest(gatewayUrl).isEmpty())
  }
}
