@file:Suppress("DEPRECATION")

package ai.openbot.app.account

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

//
// Android SECURE CREDENTIAL STORE for account-scoped employee sessions (1.3-android).
//
// Backed by Android Keystore + EncryptedSharedPreferences (mirrors SecurePrefs.kt
// but in its OWN encrypted file, so the employee identity is isolated from the
// node-pairing prefs — contract §invariant 5: employee vs node are orthogonal).
//
// Stores, per account (namespaced by accountId): userEmail, gatewayBaseURL,
// activeOrgId, credential handle, webDataStoreId, and the client session jar's
// cookie snapshot. Global singletons: active-account + app-lock. Plaintext
// credentials NEVER touch plain prefs (contract §invariant 6).
//
// This class is Android-backed; verify on-device. The pure model + cookie jar
// (AccountModel.kt / AccountCookieJar.kt) carry the unit-tested logic.
//
class AccountSessionStore(context: Context) : AccountCookiePersistence {
  private companion object {
    const val PREFS_NAME = "openbot.employee.secure"
    const val ACCOUNTS_INDEX = "openbot.accounts"
  }

  private val appContext = context.applicationContext
  private val json = Json { ignoreUnknownKeys = true }

  private val masterKey by lazy {
    MasterKey.Builder(appContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
  }

  private val prefs: SharedPreferences by lazy {
    EncryptedSharedPreferences.create(
      appContext,
      PREFS_NAME,
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  // ---- account registry ------------------------------------------------------

  fun accountIds(): List<String> {
    val raw = prefs.getString(ACCOUNTS_INDEX, null) ?: return emptyList()
    return runCatching { json.decodeFromString(ListSerializer(String.serializer()), raw) }
      .getOrDefault(emptyList())
  }

  fun listAccounts(): List<Account> = accountIds().mapNotNull { loadAccount(it) }

  fun loadAccount(accountId: String): Account? {
    val email = readKey(accountId, AccountStorageKeys.USER_EMAIL) ?: return null
    val gateway = readKey(accountId, AccountStorageKeys.GATEWAY_BASE_URL) ?: return null
    return Account(
      accountId = accountId,
      gatewayBaseURL = gateway,
      userEmail = email,
      activeOrgId = readKey(accountId, AccountStorageKeys.ACTIVE_ORG_ID),
    )
  }

  /** Add or update an account after a successful login; returns the stored account. */
  fun upsertAccount(account: Account, credential: String?): Account {
    writeKey(account.accountId, AccountStorageKeys.USER_EMAIL, account.userEmail)
    writeKey(account.accountId, AccountStorageKeys.GATEWAY_BASE_URL, account.gatewayBaseURL)
    if (account.activeOrgId != null) {
      writeKey(account.accountId, AccountStorageKeys.ACTIVE_ORG_ID, account.activeOrgId)
    }
    if (credential != null) {
      writeKey(account.accountId, AccountStorageKeys.CREDENTIAL, credential)
    }
    // Ensure a WebView data-store id exists (parity with iOS/macOS WKWebsiteDataStore UUID).
    if (readKey(account.accountId, AccountStorageKeys.WEB_DATA_STORE_ID) == null) {
      writeKey(account.accountId, AccountStorageKeys.WEB_DATA_STORE_ID, UUID.randomUUID().toString())
    }
    addToIndex(account.accountId)
    return account
  }

  fun credential(accountId: String): String? = readKey(accountId, AccountStorageKeys.CREDENTIAL)

  fun saveCredential(accountId: String, credential: String) {
    writeKey(accountId, AccountStorageKeys.CREDENTIAL, credential)
  }

  fun webDataStoreId(accountId: String): String {
    readKey(accountId, AccountStorageKeys.WEB_DATA_STORE_ID)?.let { return it }
    val fresh = UUID.randomUUID().toString()
    writeKey(accountId, AccountStorageKeys.WEB_DATA_STORE_ID, fresh)
    return fresh
  }

  fun setActiveOrg(accountId: String, orgId: String?) {
    if (orgId.isNullOrBlank()) {
      remove(AccountStorageKeys.key(accountId, AccountStorageKeys.ACTIVE_ORG_ID))
    } else {
      writeKey(accountId, AccountStorageKeys.ACTIVE_ORG_ID, orgId.trim())
    }
  }

  // ---- active account + app lock (global singletons) -------------------------

  fun activeAccountId(): String? = prefs.getString(AccountStorageKeys.ACTIVE_ACCOUNT, null)

  fun setActiveAccount(accountId: String?) {
    prefs.edit {
      if (accountId.isNullOrBlank()) remove(AccountStorageKeys.ACTIVE_ACCOUNT)
      else putString(AccountStorageKeys.ACTIVE_ACCOUNT, accountId)
    }
  }

  fun appLockPolicy(): String? = prefs.getString(AccountStorageKeys.APP_LOCK, null)

  fun setAppLockPolicy(policy: String?) {
    prefs.edit {
      if (policy.isNullOrBlank()) remove(AccountStorageKeys.APP_LOCK) else putString(AccountStorageKeys.APP_LOCK, policy)
    }
  }

  // ---- lifecycle: logout / remove --------------------------------------------

  /** Wipe every key in this account's namespace (credential, cookies, org, etc.). */
  fun removeAccount(accountId: String) {
    val toRemove = prefs.all.keys.filter { AccountStorageKeys.belongsTo(it, accountId) }
    prefs.edit {
      for (key in toRemove) remove(key)
    }
    removeFromIndex(accountId)
    if (activeAccountId() == accountId) {
      setActiveAccount(accountIds().firstOrNull())
    }
  }

  // ---- AccountCookiePersistence (client session jar snapshot) ----------------

  override fun load(accountId: String): List<String> {
    val raw = readKey(accountId, AccountStorageKeys.COOKIES) ?: return emptyList()
    return runCatching { json.decodeFromString(ListSerializer(String.serializer()), raw) }
      .getOrDefault(emptyList())
  }

  override fun save(accountId: String, serialized: List<String>) {
    if (serialized.isEmpty()) {
      remove(AccountStorageKeys.key(accountId, AccountStorageKeys.COOKIES))
      return
    }
    writeKey(
      accountId,
      AccountStorageKeys.COOKIES,
      json.encodeToString(ListSerializer(String.serializer()), serialized),
    )
  }

  override fun clear(accountId: String) {
    remove(AccountStorageKeys.key(accountId, AccountStorageKeys.COOKIES))
  }

  // ---- low-level helpers -----------------------------------------------------

  private fun readKey(accountId: String, suffix: String): String? =
    prefs.getString(AccountStorageKeys.key(accountId, suffix), null)?.takeIf { it.isNotEmpty() }

  private fun writeKey(accountId: String, suffix: String, value: String) {
    prefs.edit { putString(AccountStorageKeys.key(accountId, suffix), value) }
  }

  private fun remove(fullKey: String) {
    prefs.edit { remove(fullKey) }
  }

  private fun addToIndex(accountId: String) {
    val ids = accountIds().toMutableList()
    if (!ids.contains(accountId)) {
      ids.add(accountId)
      writeIndex(ids)
    }
  }

  private fun removeFromIndex(accountId: String) {
    val ids = accountIds().toMutableList()
    if (ids.remove(accountId)) writeIndex(ids)
  }

  private fun writeIndex(ids: List<String>) {
    prefs.edit {
      putString(ACCOUNTS_INDEX, json.encodeToString(ListSerializer(String.serializer()), ids))
    }
  }
}
