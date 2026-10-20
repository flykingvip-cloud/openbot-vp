package ai.openbot.app.vaultsync

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

@Serializable
data class VaultSyncBinding(
  val vaultId: String,
  val deviceId: String,
  val saltB64: String,
  val encryptionVersion: Int = VaultSyncConstants.ENCRYPTION_VERSION,
  val rememberPassword: Boolean = false,
)

/** Key/value backend so unit tests can avoid Android Keystore. */
interface VaultSyncSecureStoreBackend {
  fun loadString(key: String): String?

  fun saveString(key: String, value: String): Boolean

  fun delete(key: String): Boolean
}

/**
 * Keystore-backed secure store for vault-sync.
 * Sync passwords / bindings never touch plain SharedPreferences.
 */
class VaultSyncSecureStore(
  private val backend: VaultSyncSecureStoreBackend,
) {
  private val json = Json { ignoreUnknownKeys = true }

  companion object {
    private const val BINDING_PREFIX = "binding."
    private const val PASSWORD_PREFIX = "password."
    private const val BINDING_INDEX_KEY = "bindings.index"

    fun bindingKey(vaultId: String) = "$BINDING_PREFIX$vaultId"

    fun passwordKey(vaultId: String) = "$PASSWORD_PREFIX$vaultId"

    fun create(context: Context): VaultSyncSecureStore =
      VaultSyncSecureStore(EncryptedVaultSyncSecureStoreBackend(context.applicationContext))
  }

  fun saveBinding(binding: VaultSyncBinding): Boolean {
    val ok =
      backend.saveString(
        bindingKey(binding.vaultId),
        json.encodeToString(VaultSyncBinding.serializer(), binding),
      )
    if (ok) {
      val ids = loadBindingIds().toMutableList()
      if (!ids.contains(binding.vaultId)) {
        ids.add(binding.vaultId)
        saveBindingIds(ids)
      }
    }
    return ok
  }

  fun loadBinding(vaultId: String): VaultSyncBinding? {
    val raw = backend.loadString(bindingKey(vaultId)) ?: return null
    return runCatching { json.decodeFromString(VaultSyncBinding.serializer(), raw) }.getOrNull()
  }

  fun listBindings(): List<VaultSyncBinding> =
    loadBindingIds().mapNotNull { loadBinding(it) }

  fun deleteBinding(vaultId: String): Boolean {
    backend.delete(passwordKey(vaultId))
    val deleted = backend.delete(bindingKey(vaultId))
    saveBindingIds(loadBindingIds().filter { it != vaultId })
    return deleted
  }

  private fun loadBindingIds(): List<String> {
    val raw = backend.loadString(BINDING_INDEX_KEY) ?: return emptyList()
    return runCatching {
        json.decodeFromString(ListSerializer(String.serializer()), raw)
      }
      .getOrElse { emptyList() }
  }

  private fun saveBindingIds(ids: List<String>) {
    backend.saveString(BINDING_INDEX_KEY, json.encodeToString(ListSerializer(String.serializer()), ids))
  }

  fun savePassword(vaultId: String, password: String): Boolean =
    backend.saveString(passwordKey(vaultId), password)

  fun loadPassword(vaultId: String): String? = backend.loadString(passwordKey(vaultId))

  fun deletePassword(vaultId: String): Boolean = backend.delete(passwordKey(vaultId))
}

class EncryptedVaultSyncSecureStoreBackend(
  context: Context,
) : VaultSyncSecureStoreBackend {
  @Suppress("DEPRECATION")
  private val prefs: SharedPreferences by lazy {
    val masterKey =
      MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    EncryptedSharedPreferences.create(
      context,
      VaultSyncConstants.SECURE_PREFS_NAME,
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  override fun loadString(key: String): String? = prefs.getString(key, null)

  override fun saveString(key: String, value: String): Boolean {
    prefs.edit { putString(key, value) }
    return true
  }

  override fun delete(key: String): Boolean {
    prefs.edit { remove(key) }
    return true
  }
}

/** In-process unlock cache — derived keys stay memory-only in later crypto work. */
object VaultSyncUnlockMemory {
  private val passwords = LinkedHashMap<String, String>()

  @Synchronized
  fun setPassword(vaultId: String, password: String) {
    passwords[vaultId] = password
  }

  @Synchronized
  fun password(vaultId: String): String? = passwords[vaultId]

  @Synchronized
  fun clear(vaultId: String) {
    passwords.remove(vaultId)
  }

  @Synchronized
  fun clearAll() {
    passwords.clear()
  }
}

class MemoryVaultSyncSecureStoreBackend : VaultSyncSecureStoreBackend {
  private val values = LinkedHashMap<String, String>()

  @Synchronized
  override fun loadString(key: String): String? = values[key]

  @Synchronized
  override fun saveString(key: String, value: String): Boolean {
    values[key] = value
    return true
  }

  @Synchronized
  override fun delete(key: String): Boolean {
    values.remove(key)
    return true
  }
}
