package ai.openbot.app.account

import java.security.MessageDigest
import java.util.Locale

//
// Tri-Platform Employee Shell — Android account-scoped session model (1.3-android).
//
// Pure, Android-free model + key schema for the account-scoped session/storage
// contract. Platform-backed storage (Keystore / EncryptedSharedPreferences,
// WebView, OkHttp) live in sibling files; this file is unit-testable on the JVM.
//
// Contract: .kiro/specs/client-apps-pc-mobile/contracts/account-session-model.md (v1).
//
// An Account = one {gatewayBaseURL, userEmail} login identity (may carry several
// switchable orgs). All persistent keys are namespaced by a stable, email-free
// `accountId` so multiple accounts/orgs never bleed into one another.
//

/** Stable, email-free account identity derived from {gatewayBaseURL, userEmail}. */
object AccountId {
  /** Compatibility host. Conversation history lives on www, never on gw. */
  fun canonicalizeCloudGatewayUrl(raw: String): String =
    raw.replace(Regex("(?i)gw\\.openbot\\.love"), "www.openbot.love")

  /**
   * `sha256(lower(gatewayBaseURL) + "\n" + lower(userEmail))`, first 16 hex chars.
   *
   * Deliberately does NOT embed plaintext email so it is safe to use as a key
   * namespace prefix, and is stably recomputable from the same inputs
   * (contract §Account entity, §invariant 7).
   */
  fun compute(gatewayBaseURL: String, userEmail: String): String {
    val normalizedGateway = canonicalizeCloudGatewayUrl(gatewayBaseURL).trim().lowercase(Locale.ROOT)
    val normalizedEmail = userEmail.trim().lowercase(Locale.ROOT)
    val input = "$normalizedGateway\n$normalizedEmail"
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    val hex = buildString(digest.size * 2) {
      for (byte in digest) {
        append("%02x".format(byte))
      }
    }
    return hex.substring(0, 16)
  }
}

/**
 * An account login identity. Mutable per-account state (activeOrgId etc.) is
 * persisted in the secure store keyed by [accountId]; this data class is an
 * in-memory snapshot.
 */
data class Account(
  val accountId: String,
  val gatewayBaseURL: String,
  val userEmail: String,
  val activeOrgId: String? = null,
) {
  companion object {
    fun create(gatewayBaseURL: String, userEmail: String, activeOrgId: String? = null): Account {
      val trimmedGateway = AccountId.canonicalizeCloudGatewayUrl(gatewayBaseURL.trim())
      val trimmedEmail = userEmail.trim()
      return Account(
        accountId = AccountId.compute(trimmedGateway, trimmedEmail),
        gatewayBaseURL = trimmedGateway,
        userEmail = trimmedEmail,
        activeOrgId = activeOrgId?.trim()?.takeIf { it.isNotEmpty() },
      )
    }
  }
}

/**
 * Persistent key schema (contract §存储键 schema). Per-account keys are prefixed
 * with `openbot.account.<accountId>.`; global keys are unprefixed singletons.
 * Switching accounts only flips [ACTIVE_ACCOUNT] + swaps the store handle; it
 * never reads/writes across account namespaces.
 */
object AccountStorageKeys {
  const val NAMESPACE_PREFIX = "openbot.account."

  // Global singletons.
  const val ACTIVE_ACCOUNT = "openbot.active-account"
  const val APP_LOCK = "openbot.app-lock"

  // Per-account key suffixes.
  const val USER_EMAIL = "userEmail"
  const val GATEWAY_BASE_URL = "gatewayBaseURL"
  const val ACTIVE_ORG_ID = "activeOrgId"
  const val CREDENTIAL = "credential"
  const val WEB_DATA_STORE_ID = "webDataStoreId"
  const val PUSH_TOKEN = "pushToken" // Wave 2
  const val COOKIES = "cookies" // client session jar snapshot (encrypted)

  /** Namespace prefix for a given account, e.g. `openbot.account.<id>.`. */
  fun namespace(accountId: String): String = "$NAMESPACE_PREFIX$accountId."

  /** Build a fully-qualified per-account key, e.g. `openbot.account.<id>.userEmail`. */
  fun key(accountId: String, suffix: String): String = "${namespace(accountId)}$suffix"

  /** True when [key] belongs to [accountId]'s namespace (used for scoped wipe on logout). */
  fun belongsTo(key: String, accountId: String): Boolean = key.startsWith(namespace(accountId))
}
