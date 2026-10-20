package ai.openbot.app.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeliverableEnvelopeTest {
  @Test
  fun parseTaggedEnvelopeWithTitleFileAndUrl() {
    val text =
      """
      摘要如下。
      <<DELIVERABLE title="演讲三大要点设计" file="output/speech.md" url="https://example.com/d">>
      body here
      <</DELIVERABLE>>
      """.trimIndent()

    val envelope = extractDeliverableEnvelope(text)
    assertNotNull(envelope)
    assertEquals(DeliverableEnvelope.Kind.Tag, envelope!!.kind)
    assertEquals("演讲三大要点设计", envelope.title)
    assertEquals("output/speech.md", envelope.file)
    assertEquals("https://example.com/d", envelope.url)
    assertEquals("body here", envelope.body)
    assertEquals("演讲三大要点设计", envelope.targetLabel())
  }

  @Test
  fun extractLocatedIgnoresEnvelopeWithoutFileOrUrl() {
    val text =
      """
      <<DELIVERABLE title="仅标题无位置">>
      这段正文超过二十个字符用来通过长度门槛但没有位置声明。
      <</DELIVERABLE>>
      """.trimIndent()
    assertTrue(extractLocatedDeliverableEnvelopes(text).isEmpty())
    // Footer resolver must hide when neither file nor url
    assertNull(resolveDeliverableFooterEnvelope(text))
  }

  @Test
  fun rejectUnsafeWorkspacePaths() {
    assertNull(normalizeDeliverableWorkspacePath("/etc/passwd"))
    assertNull(normalizeDeliverableWorkspacePath("../secret"))
    assertNull(normalizeDeliverableWorkspacePath("C:/Windows/System32"))
    assertEquals("output/ok.md", normalizeDeliverableWorkspacePath("output/ok.md"))
  }

  @Test
  fun stripTagsKeepsSurroundingMarkdownTable() {
    val text =
      """
      | 要点 | 关键词 |
      | --- | --- |
      | 一 | 变化 |

      <<DELIVERABLE title="演讲三大要点设计" url="https://example.com/x">>
      <</DELIVERABLE>>
      """.trimIndent()
    val stripped = stripDeliverableEnvelopeTags(text)
    assertTrue(stripped.contains("| 要点 | 关键词 |"))
    assertFalse(stripped.contains("DELIVERABLE"))
    assertFalse(stripped.contains("example.com"))
  }

  @Test
  fun footerResolvesUrlFixture() {
    val text =
      """
      hello
      <<DELIVERABLE title="演讲三大要点设计" url="https://example.com/openbot-demo-deliverable">>
      <</DELIVERABLE>>
      """.trimIndent()
    val envelope = resolveDeliverableFooterEnvelope(text)
    assertNotNull(envelope)
    assertTrue(deliverableOpenEnabled(envelope!!))
    assertEquals("演讲三大要点设计", envelope.targetLabel())
  }

  @Test
  fun fileOnlyDisablesOpen() {
    val text =
      """
      <<DELIVERABLE title="演讲三大要点设计" file="output/speech-outline.md">>
      <</DELIVERABLE>>
      """.trimIndent()
    val envelope = resolveDeliverableFooterEnvelope(text)
    assertNotNull(envelope)
    assertFalse(deliverableOpenEnabled(envelope!!))
  }
}
