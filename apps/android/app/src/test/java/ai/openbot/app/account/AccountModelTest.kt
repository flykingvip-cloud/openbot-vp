package ai.openbot.app.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Account model unit tests (1.3-android). Pure JVM: exercises accountId
 * derivation + key namespacing per account-session-model.md.
 */
class AccountModelTest {
  @Test
  fun accountIdMatchesFrozenFormula() {
    // Expected values computed from sha256(lower(gw)+"\n"+lower(email))[:16].
    assertEquals(
      "be5105cb11a9db32",
      AccountId.compute("https://www.openbot.love", "alice@example.com"),
    )
    assertEquals(
      "be5105cb11a9db32",
      AccountId.compute("https://gw.openbot.love", "alice@example.com"),
    )
    assertEquals(
      "22c191851bdc0761",
      AccountId.compute("https://gw.acme.internal:8443", "bob@acme.internal"),
    )
  }

  @Test
  fun accountIdIsCaseInsensitiveAndTrimmed() {
    val canonical = AccountId.compute("https://gw.openbot.love", "alice@example.com")
    assertEquals(canonical, AccountId.compute("https://GW.OpenBot.love", "ALICE@Example.com"))
    assertEquals(canonical, AccountId.compute("  https://gw.openbot.love  ", " alice@example.com "))
  }

  @Test
  fun accountIdIsEmailFreeAndFixedWidth() {
    val id = AccountId.compute("https://gw.openbot.love", "alice@example.com")
    assertEquals(16, id.length)
    assertFalse(id.contains("alice"))
    assertTrue(id.all { it in "0123456789abcdef" })
  }

  @Test
  fun differentGatewaysProduceDifferentIds() {
    assertNotEquals(
      AccountId.compute("https://gw.openbot.love", "alice@example.com"),
      AccountId.compute("https://gw.other.host", "alice@example.com"),
    )
  }

  @Test
  fun accountCreateNormalizesFields() {
    val account = Account.create(" https://gw.openbot.love ", " alice@example.com ", activeOrgId = " ")
    assertEquals("https://www.openbot.love", account.gatewayBaseURL)
    assertEquals("alice@example.com", account.userEmail)
    assertNull(account.activeOrgId)
    assertEquals(AccountId.compute("https://www.openbot.love", "alice@example.com"), account.accountId)
  }

  @Test
  fun storageKeysAreNamespacedPerAccount() {
    val id = "0b592c41a3c22934"
    assertEquals("openbot.account.0b592c41a3c22934.", AccountStorageKeys.namespace(id))
    assertEquals(
      "openbot.account.0b592c41a3c22934.userEmail",
      AccountStorageKeys.key(id, AccountStorageKeys.USER_EMAIL),
    )
    assertEquals("openbot.active-account", AccountStorageKeys.ACTIVE_ACCOUNT)
  }

  @Test
  fun belongsToOnlyMatchesOwnNamespace() {
    val a = "0b592c41a3c22934"
    val b = "22c191851bdc0761"
    val credA = AccountStorageKeys.key(a, AccountStorageKeys.CREDENTIAL)
    assertTrue(AccountStorageKeys.belongsTo(credA, a))
    assertFalse(AccountStorageKeys.belongsTo(credA, b))
    assertFalse(AccountStorageKeys.belongsTo(AccountStorageKeys.ACTIVE_ACCOUNT, a))
  }
}
