package ai.openbot.app.ui.chat

import ai.openbot.app.chat.ChatAgentEntry
import ai.openbot.app.chat.ChatSessionEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentStripNavTest {
  @Test
  fun stripSeedsDaibaiFirstAndToHeaderFromAgentsList() {
    val agents =
      listOf(
        ChatAgentEntry(id = "main", name = "大白管家", isDefault = true),
        ChatAgentEntry(id = "market", name = "市场助手"),
      )
    val sessions =
      listOf(
        ChatSessionEntry(key = "main", updatedAtMs = 1_700_000_000_000L, displayName = "大白管家"),
        ChatSessionEntry(key = "agent:market:main", updatedAtMs = 1_700_000_000_000L - 1_000, displayName = "市场助手"),
        ChatSessionEntry(key = "space:digital-team", updatedAtMs = 1_700_000_000_000L - 2_000, displayName = "数字人战队"),
      )

    val model =
      buildAgentStripNavModel(
        agents = agents,
        sessions = sessions,
        activeSessionKey = "main",
        mainSessionKey = "main",
      )

    assertEquals(BUILTIN_STEWARD_NAV_ID, model.assistantItems.first().id)
    assertEquals(BUILTIN_STEWARD_NAME, model.assistantItems.first().title)
    assertTrue(model.assistantItems.first().active)
    assertEquals(1, model.spaceItems.size)
    assertEquals("space:digital-team", model.spaceItems.first().selectionKey)
    assertEquals("TO: 大白管家", model.toHeaderLabel("main"))
    assertEquals(model.assistantItems.size + model.spaceItems.size, model.stripItems.size)
  }

  @Test
  fun selectAssistantUpdatesToHeader() {
    val agents =
      listOf(
        ChatAgentEntry(id = "main", name = "大白管家", isDefault = true),
        ChatAgentEntry(id = "market", name = "市场助手"),
      )
    val sessions =
      listOf(
        ChatSessionEntry(key = "main", updatedAtMs = 1L, displayName = "大白管家"),
        ChatSessionEntry(key = "agent:market:main", updatedAtMs = 1L, displayName = "市场助手"),
      )
    val model =
      buildAgentStripNavModel(
        agents = agents,
        sessions = sessions,
        activeSessionKey = "agent:market:main",
        mainSessionKey = "main",
      )
    assertFalse(model.assistantItems.first().active)
    assertTrue(model.assistantItems.any { it.selectionKey == "agent:market:main" && it.active })
    assertEquals("TO: 市场助手", model.toHeaderLabel("agent:market:main"))
  }

  @Test
  fun spaceActiveDoesNotWinOverStewardSession() {
    val agents = listOf(ChatAgentEntry(id = "main", name = "大白管家", isDefault = true))
    val sessions =
      listOf(
        ChatSessionEntry(key = "main", updatedAtMs = 1L, displayName = "大白管家"),
        ChatSessionEntry(key = "space:team-a", updatedAtMs = 1L, displayName = "产品研发小组"),
      )
    val model =
      buildAgentStripNavModel(
        agents = agents,
        sessions = sessions,
        activeSessionKey = "main",
        mainSessionKey = "main",
      )
    assertTrue(model.assistantItems.first().active)
    assertTrue(model.spaceItems.isNotEmpty())
    assertFalse(model.spaceItems.first().active)
    assertEquals("TO: 大白管家", model.toHeaderLabel("main"))
  }

  @Test
  fun sanitizeCollapsesDuplicatedStewardSuffix() {
    assertEquals("大白管家", sanitizeWorkbenchPeerTitle("大白管家家"))
    assertEquals(
      "TO: 大白管家",
      buildAgentStripNavModel(
        agents = listOf(ChatAgentEntry(id = "main", name = "大白管家家", isDefault = true)),
        sessions = emptyList(),
        activeSessionKey = "main",
        mainSessionKey = "main",
      ).toHeaderLabel("main"),
    )
  }

  @Test
  fun emptyAgentsStillOfferSteward() {
    val model =
      buildAgentStripNavModel(
        agents = emptyList(),
        sessions = emptyList(),
        activeSessionKey = "main",
        mainSessionKey = "main",
      )
    assertEquals(1, model.assistantItems.size)
    assertEquals(BUILTIN_STEWARD_NAME, model.assistantItems.first().rawTitle)
    assertEquals("TO: 大白管家", model.toHeaderLabel("main"))
  }

  @Test
  fun rosterUsesAgentsListNotRecentSessionWindow() {
    // Stale session (>24h) must still appear when listed in agents.list.
    val now = 1_700_000_000_000L
    val stale = now - (48L * 60 * 60 * 1000)
    val agents =
      listOf(
        ChatAgentEntry(id = "main", name = "大白管家", isDefault = true),
        ChatAgentEntry(id = "market", name = "市场助手"),
      )
    val sessions =
      listOf(
        ChatSessionEntry(key = "main", updatedAtMs = now, displayName = "大白管家"),
        ChatSessionEntry(key = "agent:market:main", updatedAtMs = stale, displayName = "市场助手"),
      )
    val model =
      buildAgentStripNavModel(
        agents = agents,
        sessions = sessions,
        activeSessionKey = "main",
        mainSessionKey = "main",
      )
    assertTrue(model.assistantItems.any { it.selectionKey == "agent:market:main" })
    assertEquals(2, model.assistantItems.size)
  }

  @Test
  fun badgeCapsAtNineLikeWorkbenchChrome() {
    assertNull(formatAgentStripBadge(null))
    assertNull(formatAgentStripBadge(0))
    assertEquals("1", formatAgentStripBadge(1))
    assertEquals("9", formatAgentStripBadge(9))
    assertEquals("9", formatAgentStripBadge(10))
    assertEquals("9", formatAgentStripBadge(99))
    assertEquals("9", formatAgentStripBadge(100))
  }
}
