package ai.openbot.app.account

import android.content.Context
import android.webkit.CookieManager
import java.util.concurrent.ConcurrentHashMap
import okhttp3.OkHttpClient

//
// Employee session manager — single-active-account model (1.3-android).
//
// Ties together the three isolated stores from account-session-model.md:
//   1) CLIENT SESSION JAR  — a per-account OkHttp CookieJar (holds the login
//      session used to mint bootstrap tokens). Multiple may coexist.
//   2) WEBVIEW SESSION      — the HttpOnly employee cookie written by
//      `/native/bootstrap`. Android's CookieManager is PROCESS-GLOBAL and
//      `WebView.setDataDirectorySuffix` can only be set once per process before
//      any WebView, so Wave 1 keeps ONE active account's Employee Shell mounted
//      and clears the gateway-domain cookies on switch/org-change/logout
//      (contract §Android 约束).
//   3) SECURE CREDENTIAL    — AccountSessionStore (Keystore-backed).
//
// Employee session changes NEVER touch the node-pairing session (SecurePrefs):
// the two identities are orthogonal (contract §invariant 5).
//
class EmployeeSessionManager(context: Context) {
  private val appContext = context.applicationContext
  private val store = AccountSessionStore(appContext)

  // One OkHttpClient (with its own cookie jar) per account; coexist safely.
  private val clients = ConcurrentHashMap<String, OkHttpClient>()

  val secureStore: AccountSessionStore get() = store

  fun accounts(): List<Account> = store.listAccounts()

  fun activeAccount(): Account? = store.activeAccountId()?.let { store.loadAccount(it) }

  /** OkHttpClient whose CookieJar carries [accountId]'s login session (for mint). */
  fun clientFor(accountId: String): OkHttpClient =
    clients.getOrPut(accountId) {
      OkHttpClient.Builder()
        .cookieJar(AccountCookieJar(accountId, store))
        .build()
    }

  /** Client for the current active account, or null when signed out. */
  fun activeClient(): OkHttpClient? = store.activeAccountId()?.let { clientFor(it) }

  /**
   * Record a successful login and make it the active account. Does NOT clear any
   * other account's data (contract §add/login).
   */
  fun onLoggedIn(account: Account, credential: String?): Account {
    val stored = store.upsertAccount(account, credential)
    store.setActiveAccount(stored.accountId)
    return stored
  }

  /**
   * Switch the active account (contract §switch account): flip active id + drop
   * the previous account's WebView (gateway-domain) cookies so the single active
   * Employee Shell re-bootstraps as the new account. Neither account's stored
   * data is cleared.
   */
  fun switchAccount(accountId: String) {
    val previous = store.activeAccountId()
    if (previous != null && previous != accountId) {
      store.loadAccount(previous)?.let { clearWebViewCookies(it.gatewayBaseURL) }
    }
    store.setActiveAccount(accountId)
  }

  /**
   * Switch org within the SAME account (contract §switch org): keep accountId,
   * invalidate the WebView session, and signal a re-bootstrap into the new org.
   */
  fun switchOrg(accountId: String, orgId: String?) {
    store.setActiveOrg(accountId, orgId)
    store.loadAccount(accountId)?.let { clearWebViewCookies(it.gatewayBaseURL) }
  }

  /**
   * Log out [accountId] (contract §logout): clear its client jar + WebView
   * cookies + secure credential, and re-point active to another account (or
   * none). Node pairing is untouched.
   */
  fun logout(accountId: String) {
    // Clear the client session jar (cached instance if any, else a fresh one that
    // wipes the persisted snapshot), then the WebView cookies and secure store.
    val jar = clients.remove(accountId)?.cookieJar as? AccountCookieJar ?: AccountCookieJar(accountId, store)
    jar.clear()
    store.loadAccount(accountId)?.let { clearWebViewCookies(it.gatewayBaseURL) }
    store.removeAccount(accountId)
  }

  /**
   * Expire only the GATEWAY-ORIGIN cookies in the process-global CookieManager,
   * leaving Canvas / other WebView cookies intact (never `removeAllCookies`).
   */
  fun clearWebViewCookies(gatewayBaseURL: String) {
    val origin = originOf(gatewayBaseURL) ?: return
    val cookieManager = CookieManager.getInstance()
    val existing = cookieManager.getCookie(origin) ?: return
    for (pair in existing.split(";")) {
      val name = pair.substringBefore("=").trim()
      if (name.isEmpty()) continue
      // Expire the cookie at the gateway origin (root path).
      cookieManager.setCookie(origin, "$name=; Max-Age=0; Path=/")
    }
    cookieManager.flush()
  }

  /** `scheme://host[:port]` origin of a gateway base URL, or null when unparsable. */
  private fun originOf(gatewayBaseURL: String): String? {
    val uri = runCatching { java.net.URI(gatewayBaseURL.trim()) }.getOrNull() ?: return null
    val scheme = uri.scheme ?: return null
    val host = uri.host ?: return null
    val port = uri.port
    return if (port > 0) "$scheme://$host:$port" else "$scheme://$host"
  }
}
