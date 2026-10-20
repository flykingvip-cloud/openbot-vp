package ai.openbot.app.deeplink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Shared deep-link grammar test vectors (task 1.2-android).
 *
 * The vector table below is the SAME table the Swift `DeepLinkParser` tests use
 * (contracts/deeplink-grammar.md §共享测试向量). Both parsers must resolve each
 * row identically. New rows must be added to BOTH platforms.
 */
class EmployeeDeepLinkParserTest {
  @Test
  fun employeeOverviewResolvesToOverviewSurface() {
    assertEquals(
      EmployeeDeepLinkRoute.Employee(EmployeeSurface.Overview),
      EmployeeDeepLinkParser.parse("openclaw://employee/overview"),
    )
  }

  @Test
  fun employeeKnowledgeAcceptsPrimaryOpenBotScheme() {
    assertEquals(
      EmployeeDeepLinkRoute.Employee(EmployeeSurface.Knowledge),
      EmployeeDeepLinkParser.parse("openbot://employee/knowledge"),
    )
    assertEquals("openbot", DeepLinkSchemeSupport.CANONICAL_SCHEME)
    assertEquals("openclaw", DeepLinkSchemeSupport.LEGACY_SCHEME)
  }

  @Test
  fun employeeUnknownSurfaceFallsBackToOverview() {
    assertEquals(
      EmployeeDeepLinkRoute.Employee(EmployeeSurface.Overview),
      EmployeeDeepLinkParser.parse("openclaw://employee/bogus"),
    )
  }

  @Test
  fun employeeQueryFormResolvesSurface() {
    // Shared vector (query form, must match Swift exactly).
    assertEquals(
      EmployeeDeepLinkRoute.Employee(EmployeeSurface.Growth),
      EmployeeDeepLinkParser.parse("openclaw://employee?surface=growth"),
    )
  }

  @Test
  fun employeeWithoutSegmentOrQueryFallsBackToOverview() {
    assertEquals(
      EmployeeDeepLinkRoute.Employee(EmployeeSurface.Overview),
      EmployeeDeepLinkParser.parse("openclaw://employee"),
    )
  }

  @Test
  fun employeePathSegmentWinsOverQuerySurface() {
    // Path form is canonical: the query surface must NOT override it.
    assertEquals(
      EmployeeDeepLinkRoute.Employee(EmployeeSurface.Workspace),
      EmployeeDeepLinkParser.parse("openclaw://employee/workspace?surface=growth"),
    )
  }

  @Test
  fun chatWithParamsCarriesSessionKeyAndAgentId() {
    assertEquals(
      EmployeeDeepLinkRoute.Chat(sessionKey = "s1", agentId = "a1"),
      EmployeeDeepLinkParser.parse("openclaw://chat?sessionKey=s1&agentId=a1"),
    )
  }

  @Test
  fun chatWithoutParamsResolvesToDefaultChat() {
    assertEquals(
      EmployeeDeepLinkRoute.Chat(sessionKey = null, agentId = null),
      EmployeeDeepLinkParser.parse("openclaw://chat"),
    )
  }

  @Test
  fun spaceWithIdResolves() {
    assertEquals(
      EmployeeDeepLinkRoute.Space(spaceId = "sp_123"),
      EmployeeDeepLinkParser.parse("openclaw://space/sp_123"),
    )
  }

  @Test
  fun spaceWithEmptyIdIsRejected() {
    assertNull(EmployeeDeepLinkParser.parse("openclaw://space/"))
  }

  @Test
  fun knowledgeWithIdAndKindResolves() {
    assertEquals(
      EmployeeDeepLinkRoute.Knowledge(objectId = "obj_9", kind = "doc"),
      EmployeeDeepLinkParser.parse("openclaw://knowledge/obj_9?kind=doc"),
    )
  }

  @Test
  fun knowledgeWithEmptyIdIsRejected() {
    assertNull(EmployeeDeepLinkParser.parse("openclaw://knowledge/"))
  }

  @Test
  fun httpsSchemeIsRejected() {
    assertNull(EmployeeDeepLinkParser.parse("https://gw.openbot.love/x"))
  }

  @Test
  fun pathTraversalIsRejected() {
    assertNull(EmployeeDeepLinkParser.parse("openclaw://employee/../etc"))
  }

  @Test
  fun unknownHostIsRejected() {
    assertNull(EmployeeDeepLinkParser.parse("openclaw://unknownhost"))
  }

  // ---- additional hardening (not in the shared table, Android-local) --------

  @Test
  fun blankAndNullInputsRejected() {
    assertNull(EmployeeDeepLinkParser.parse(null))
    assertNull(EmployeeDeepLinkParser.parse(""))
    assertNull(EmployeeDeepLinkParser.parse("   "))
  }

  @Test
  fun schemeIsCaseInsensitive() {
    assertEquals(
      EmployeeDeepLinkRoute.Employee(EmployeeSurface.Me),
      EmployeeDeepLinkParser.parse("OpenClaw://employee/me"),
    )
  }

  @Test
  fun knowledgeInjectionKindIsDropped() {
    // Optional param carrying an embedded scheme is dropped, link still resolves.
    assertEquals(
      EmployeeDeepLinkRoute.Knowledge(objectId = "obj_9", kind = null),
      EmployeeDeepLinkParser.parse("openclaw://knowledge/obj_9?kind=javascript:alert(1)"),
    )
  }

  @Test
  fun employeeSurfaceIsCaseInsensitive() {
    assertEquals(
      EmployeeDeepLinkRoute.Employee(EmployeeSurface.Workspace),
      EmployeeDeepLinkParser.parse("openclaw://employee/WORKSPACE"),
    )
  }

  @Test
  fun controlCharsRejected() {
    assertNull(EmployeeDeepLinkParser.parse("openclaw://space/sp\u0000123"))
  }

  @Test
  fun embedPathBuilderMatchesWebContract() {
    assertEquals("/embed/employee/overview", EmployeeEmbedRoutes.path(EmployeeSurface.Overview))
    assertEquals("/embed/employee/knowledge", EmployeeEmbedRoutes.path(EmployeeSurface.Knowledge))
    assertEquals("/embed/employee/overview", EmployeeEmbedRoutes.defaultPath())
  }
}
