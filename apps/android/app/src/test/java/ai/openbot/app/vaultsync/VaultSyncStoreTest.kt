package ai.openbot.app.vaultsync

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class VaultSyncPathPolicyTest {
  @Test
  fun excludesRuntimeDerivatives() {
    assertTrue(VaultSyncPathPolicy.isAlwaysExcluded(".openbot/index.sqlite"))
    assertTrue(VaultSyncPathPolicy.isAlwaysExcluded("embeddings/foo.bin"))
    assertTrue(VaultSyncPathPolicy.isAlwaysExcluded("notes.md~"))
    assertFalse(VaultSyncPathPolicy.isAlwaysExcluded("notes.md"))
  }

  @Test
  fun rejectsPathTraversal() {
    assertFalse(VaultSyncPathPolicy.isSafeRelativePath("../secret.md"))
    assertTrue(VaultSyncPathPolicy.isSafeRelativePath("folder/note.md"))
  }
}

class VaultSyncSecureStoreTest {
  @Test
  fun bindingAndPasswordRoundTrip() {
    val store = VaultSyncSecureStore(MemoryVaultSyncSecureStoreBackend())
    val binding =
      VaultSyncBinding(
        vaultId = "vault-1",
        deviceId = "device-a",
        saltB64 = "c2FsdA==",
        encryptionVersion = 1,
        rememberPassword = true,
      )
    assertTrue(store.saveBinding(binding))
    assertEquals(binding, store.loadBinding("vault-1"))
    assertEquals(listOf(binding), store.listBindings())
    assertTrue(store.savePassword("vault-1", "secret-pw"))
    assertEquals("secret-pw", store.loadPassword("vault-1"))
    assertTrue(store.deleteBinding("vault-1"))
    assertNull(store.loadBinding("vault-1"))
    assertNull(store.loadPassword("vault-1"))
    assertTrue(store.listBindings().isEmpty())
  }
}

class VaultSyncLocalFileStoreTest {
  @Test
  fun writesUnderVaultFilesAndBlocksUnsafePaths() {
    val root = File.createTempFile("vault-sync-android-", "-root")
    assertTrue(root.delete())
    assertTrue(root.mkdirs())
    try {
      val store = VaultSyncLocalFileStore(root)
      store.ensureVaultLayout("v1", "d1")
      store.writeFile("v1", "notes/a.md", "# hi\n".toByteArray())
      assertEquals("# hi\n", store.readFile("v1", "notes/a.md").toString(Charsets.UTF_8))
      try {
        store.writeFile("v1", "../x.md", ByteArray(0))
        fail("expected unsafe path")
      } catch (_: VaultSyncLocalFileStoreException) {
        // expected
      }
    } finally {
      root.deleteRecursively()
    }
  }
}
