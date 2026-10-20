package ai.openbot.app.employeeauth

import org.junit.Assert.assertEquals
import org.junit.Test

class EmployeeAuthChangePasswordBodyTest {
  @Test
  fun changePasswordBodyMatchesWebPlatformAuth() {
    val body = employeeAuthChangePasswordBody(currentPassword = "old", newPassword = "new-secret")
    assertEquals("old", body["currentPassword"])
    assertEquals("new-secret", body["newPassword"])
    assertEquals(listOf("currentPassword", "newPassword"), body.keys.toList())
  }
}
