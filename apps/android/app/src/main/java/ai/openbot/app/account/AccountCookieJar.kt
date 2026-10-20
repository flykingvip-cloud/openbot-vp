package ai.openbot.app.account

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

//
// Per-account OkHttp CookieJar (1.3-android).
//
// The CLIENT SESSION JAR from account-session-model.md: it holds the employee
// platform-auth login session cookie used to call `/native/bootstrap/mint`.
// Each account gets its OWN jar instance (they may coexist — unlike the
// process-global WebView CookieManager), so no account's login cookie can leak
// into another (contract §invariant 1/2). NEVER share one jar across accounts.
//
// Persistence is pluggable so this jar is unit-testable on the JVM; the Android
// wiring backs it with EncryptedSharedPreferences (see AccountSessionStore).
//

/** Serialized-cookie persistence for a single account's client session jar. */
interface AccountCookiePersistence {
  fun load(accountId: String): List<String>

  fun save(accountId: String, serialized: List<String>)

  fun clear(accountId: String)
}

/** In-memory-only persistence (nothing survives process death). */
object NoopAccountCookiePersistence : AccountCookiePersistence {
  override fun load(accountId: String): List<String> = emptyList()

  override fun save(accountId: String, serialized: List<String>) {}

  override fun clear(accountId: String) {}
}

class AccountCookieJar(
  private val accountId: String,
  private val persistence: AccountCookiePersistence = NoopAccountCookiePersistence,
) : CookieJar {
  private val json = Json { ignoreUnknownKeys = true }

  // Keyed by (name, domain, path) so a re-issued cookie replaces the old one.
  private val store = LinkedHashMap<String, Cookie>()

  init {
    restore()
  }

  @Synchronized
  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    var changed = false
    val now = System.currentTimeMillis()
    for (cookie in cookies) {
      val key = keyOf(cookie)
      if (cookie.persistent && cookie.expiresAt <= now) {
        if (store.remove(key) != null) changed = true
      } else {
        store[key] = cookie
        changed = true
      }
    }
    if (changed) persist()
  }

  @Synchronized
  override fun loadForRequest(url: HttpUrl): List<Cookie> {
    val now = System.currentTimeMillis()
    val matches = ArrayList<Cookie>()
    var changed = false
    val iterator = store.values.iterator()
    while (iterator.hasNext()) {
      val cookie = iterator.next()
      if (cookie.persistent && cookie.expiresAt <= now) {
        iterator.remove()
        changed = true
        continue
      }
      if (cookie.matches(url)) matches.add(cookie)
    }
    if (changed) persist()
    return matches
  }

  /** Drop all cookies for this account (logout / switch-org / remove-account). */
  @Synchronized
  fun clear() {
    store.clear()
    persistence.clear(accountId)
  }

  /** Snapshot of currently held cookies (test/inspection helper). */
  @Synchronized
  fun snapshot(): List<Cookie> = store.values.toList()

  private fun keyOf(cookie: Cookie): String = "${cookie.name}|${cookie.domain}|${cookie.path}"

  // Persist ONLY persistent cookies; session cookies are intentionally volatile.
  private fun persist() {
    val serialized = store.values.filter { it.persistent }.map { serialize(it) }
    persistence.save(accountId, serialized)
  }

  private fun restore() {
    for (raw in persistence.load(accountId)) {
      val cookie = deserialize(raw) ?: continue
      store[keyOf(cookie)] = cookie
    }
  }

  private fun serialize(cookie: Cookie): String =
    json.encodeToString(
      PersistedCookie.serializer(),
      PersistedCookie(
        name = cookie.name,
        value = cookie.value,
        expiresAt = cookie.expiresAt,
        domain = cookie.domain,
        path = cookie.path,
        secure = cookie.secure,
        httpOnly = cookie.httpOnly,
        hostOnly = cookie.hostOnly,
        persistent = cookie.persistent,
      ),
    )

  private fun deserialize(raw: String): Cookie? {
    val persisted =
      try {
        json.decodeFromString(PersistedCookie.serializer(), raw)
      } catch (_: Throwable) {
        return null
      }
    return try {
      val builder =
        Cookie.Builder()
          .name(persisted.name)
          .value(persisted.value)
          .path(persisted.path)
      if (persisted.hostOnly) builder.hostOnlyDomain(persisted.domain) else builder.domain(persisted.domain)
      if (persisted.persistent) builder.expiresAt(persisted.expiresAt)
      if (persisted.secure) builder.secure()
      if (persisted.httpOnly) builder.httpOnly()
      builder.build()
    } catch (_: Throwable) {
      null
    }
  }

  @Serializable
  private data class PersistedCookie(
    val name: String,
    val value: String,
    val expiresAt: Long,
    val domain: String,
    val path: String,
    val secure: Boolean,
    val httpOnly: Boolean,
    val hostOnly: Boolean,
    val persistent: Boolean,
  )
}
