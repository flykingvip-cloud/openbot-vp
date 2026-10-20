package ai.openbot.app.employeeauth

import org.junit.Assert.assertEquals
import org.junit.Test

/** Reset posts email + code + password, matching the platform-auth route and Mac client. */
class EmployeeAuthResetBodyTest {
  @Test
  fun resetBodyIncludesEmailCodeAndPassword() {
    val body = employeeAuthResetBody(email = " a@b.c ", code = " RESET-1 ", password = "secret")
    assertEquals("a@b.c", body["email"])
    assertEquals("RESET-1", body["code"])
    assertEquals("secret", body["password"])
    assertEquals(listOf("email", "code", "password"), body.keys.toList())
  }
}
