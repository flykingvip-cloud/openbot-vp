package ai.openbot.app.employeeshell

import ai.openbot.app.deeplink.EmployeeDeepLinkRoute
import ai.openbot.app.deeplink.EmployeeSurface
import org.junit.Assert.assertEquals
import org.junit.Test

/** Deep-link route -> shell route request mapping tests (1.7-android). Pure JVM. */
class EmployeeDeepLinkRouterTest {
  @Test
  fun employeeRouteMapsToEmbedSurface() {
    val request = EmployeeDeepLinkRouter.toRouteRequest(EmployeeDeepLinkRoute.Employee(EmployeeSurface.Me))
    assertEquals(EmployeeShellRouteRequest.Embed("/embed/employee/me"), request)
  }

  @Test
  fun spaceRouteMapsToWorkspaceEmbed() {
    val request = EmployeeDeepLinkRouter.toRouteRequest(EmployeeDeepLinkRoute.Space("sp_1"))
    assertEquals(EmployeeShellRouteRequest.Embed("/embed/employee/workspace?session=space%3Asp_1"), request)
  }

  @Test
  fun knowledgeRouteMapsToKnowledgeEmbed() {
    val request =
      EmployeeDeepLinkRouter.toRouteRequest(EmployeeDeepLinkRoute.Knowledge("obj_1", "doc"))
    assertEquals(EmployeeShellRouteRequest.Embed("/embed/employee/knowledge?objectId=obj_1&kind=doc"), request)
  }

  @Test
  fun chatRouteMapsToWwwEmbed() {
    val request = EmployeeDeepLinkRouter.toRouteRequest(EmployeeDeepLinkRoute.Chat("s1", "a1"))
    assertEquals(
      EmployeeShellRouteRequest.Embed("/embed/employee/overview?session=s1"),
      request,
    )
  }
}
