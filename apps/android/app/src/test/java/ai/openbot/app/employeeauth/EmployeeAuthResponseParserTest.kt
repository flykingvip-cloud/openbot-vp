package ai.openbot.app.employeeauth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure JVM tests for the platform-auth response parser (1.4-android). Covers the
 * success + representative failure shapes returned by routes-login-password.ts.
 */
class EmployeeAuthResponseParserTest {
  @Test
  fun loginSuccessParsesAsSuccess() {
    val result = EmployeeAuthResponseParser.parse(200, """{"ok":true,"session":{"id":"s1"}}""")
    assertTrue(result is EmployeeAuthResult.Success)
  }

  @Test
  fun httpOkWithoutOkFieldIsSuccess() {
    val result = EmployeeAuthResponseParser.parse(200, """{"session":{"id":"s1"}}""")
    assertTrue(result is EmployeeAuthResult.Success)
  }

  @Test
  fun forgotPasswordAlwaysSucceeds() {
    val result = EmployeeAuthResponseParser.parse(200, """{"ok":true}""")
    assertTrue(result is EmployeeAuthResult.Success)
    assertNull((result as EmployeeAuthResult.Success).pendingResetCode)
  }

  @Test
  fun forgotPasswordExtractsDevResetCode() {
    val body =
      """{"ok":true,"platformAuth":{"pendingPasswordReset":{"kind":"password-reset","code":"RESET-ABCD1234","email":"a@b.c"}}}"""
    val result = EmployeeAuthResponseParser.parse(200, body)
    result as EmployeeAuthResult.Success
    assertEquals("RESET-ABCD1234", result.pendingResetCode)
  }

  @Test
  fun invalidCredentialsParsesFailureWithCode() {
    val body = """{"ok":false,"code":"PLATFORM_AUTH_INVALID_CREDENTIALS","error":"Email or password is incorrect."}"""
    val result = EmployeeAuthResponseParser.parse(401, body)
    result as EmployeeAuthResult.Failure
    assertEquals(401, result.status)
    assertEquals("PLATFORM_AUTH_INVALID_CREDENTIALS", result.code)
    assertEquals("Email or password is incorrect.", result.message)
  }

  @Test
  fun weakPasswordFailurePreservesServerMessage() {
    val body = """{"ok":false,"code":"PLATFORM_AUTH_WEAK_PASSWORD","error":"Password is too weak."}"""
    val result = EmployeeAuthResponseParser.parse(400, body)
    result as EmployeeAuthResult.Failure
    assertEquals("PLATFORM_AUTH_WEAK_PASSWORD", result.code)
    assertEquals("Password is too weak.", result.message)
  }

  @Test
  fun accountLockedUsesServerMessage() {
    val body = """{"ok":false,"code":"PLATFORM_AUTH_ACCOUNT_LOCKED","error":"Too many failed attempts. Try again later."}"""
    val result = EmployeeAuthResponseParser.parse(423, body)
    result as EmployeeAuthResult.Failure
    assertEquals(423, result.status)
    assertEquals("PLATFORM_AUTH_ACCOUNT_LOCKED", result.code)
  }

  @Test
  fun errorWithoutBodyFallsBackToDefaultMessage() {
    val result = EmployeeAuthResponseParser.parse(401, null)
    result as EmployeeAuthResult.Failure
    assertNull(result.code)
    assertEquals("Email or password is incorrect.", result.message)
  }

  @Test
  fun serverErrorFallsBackToUnavailableMessage() {
    val result = EmployeeAuthResponseParser.parse(503, "not json")
    result as EmployeeAuthResult.Failure
    assertEquals(503, result.status)
    assertEquals("The gateway is unavailable. Try again later.", result.message)
  }

  @Test
  fun networkFailureStatusZeroHasNetworkDefault() {
    val result = EmployeeAuthResponseParser.parse(0, null)
    result as EmployeeAuthResult.Failure
    assertEquals("Network error.", result.message)
  }
}
