package ai.openbot.app.employeeshell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Notification deep-link extraction tests (1.7-android). Pure JVM. */
class EmployeeNotificationRouterTest {
  @Test
  fun extractsDeepLinkFromExtra() {
    assertEquals(
      "openclaw://employee/overview",
      EmployeeNotificationRouter.deepLinkFromExtra("openclaw://employee/overview"),
    )
  }

  @Test
  fun trimsWhitespace() {
    assertEquals("openbot://chat", EmployeeNotificationRouter.deepLinkFromExtra("  openbot://chat  "))
  }

  @Test
  fun blankOrNullExtraYieldsNull() {
    assertNull(EmployeeNotificationRouter.deepLinkFromExtra(null))
    assertNull(EmployeeNotificationRouter.deepLinkFromExtra("   "))
  }
}
