package ai.openbot.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DemoStripSessionTest {
  @Test
  fun stewardAndAssistantSessionsReturnDistinctTranscripts() {
    val main = demoStripMessagesForSession("main")
    val a = demoStripMessagesForSession("agent:assistant-a:main")
    val b = demoStripMessagesForSession("agent:assistant-b:main")
    val space = demoStripMessagesForSession("space:collab-a")

    assertTrue(main.isNotEmpty())
    assertTrue(a.size >= 3)
    assertEquals(1, b.size)
    assertEquals(1, space.size)
    assertTrue(main.first().content.first().text!!.contains("管家") || main.first().content.first().text!!.contains("协调"))
    assertTrue(a.any { it.role == "user" })
    assertTrue(a.any { it.content.first().text!!.contains("产品规格") })
  }

  @Test
  fun blankKeyFallsBackToMain() {
    val blank = demoStripMessagesForSession("  ")
    assertEquals(demoStripMessagesForSession("main").first().id, blank.first().id)
  }
}
