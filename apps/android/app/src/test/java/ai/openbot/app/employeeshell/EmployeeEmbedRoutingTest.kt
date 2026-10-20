package ai.openbot.app.employeeshell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bridge-intent -> route mapping tests (1.5-android). Pure JVM. */
class EmployeeEmbedRoutingTest {
  @Test
  fun surfacePathUsesEmbedPrefix() {
    assertEquals("/embed/employee/me", EmployeeEmbedRouting.embedPath("me"))
  }

  @Test
  fun spaceIntentNavigatesWorkspaceWithSpaceId() {
    val action = EmployeeEmbedRouting.action(EmployeeShellIntent.OpenSpace("sp_123"))
    action as EmployeeShellRouteAction.EmbedNavigation
    assertEquals("/embed/employee/workspace?session=space%3Asp_123", action.path)
  }

  @Test
  fun knowledgeIntentNavigatesKnowledgeWithObjectAndKind() {
    val action =
      EmployeeEmbedRouting.action(EmployeeShellIntent.OpenKnowledgeObject("obj_9", "doc"))
    action as EmployeeShellRouteAction.EmbedNavigation
    assertEquals("/embed/employee/knowledge?objectId=obj_9&kind=doc", action.path)
  }

  @Test
  fun knowledgeIntentOmitsKindWhenNull() {
    val action =
      EmployeeEmbedRouting.action(EmployeeShellIntent.OpenKnowledgeObject("obj_9", null))
    action as EmployeeShellRouteAction.EmbedNavigation
    assertEquals("/embed/employee/knowledge?objectId=obj_9", action.path)
  }

  @Test
  fun chatIntentReusesWwwEmbed() {
    val action = EmployeeEmbedRouting.action(EmployeeShellIntent.OpenChat("agent:bot-2:main", null))
    action as EmployeeShellRouteAction.EmbedNavigation
    assertEquals("/embed/employee/overview?session=agent%3Abot-2%3Amain", action.path)
  }

  @Test
  fun spaceChatIntentLandsOnWorkspaceEmbed() {
    val action = EmployeeEmbedRouting.action(EmployeeShellIntent.OpenChat("space:alpha", null))
    action as EmployeeShellRouteAction.EmbedNavigation
    assertEquals("/embed/employee/workspace?session=space%3Aalpha", action.path)
  }

  @Test
  fun deviceSettingsIntentStaysNative() {
    val action = EmployeeEmbedRouting.action(EmployeeShellIntent.OpenDeviceSettings(null))
    assertTrue(action is EmployeeShellRouteAction.Native)
  }
}
