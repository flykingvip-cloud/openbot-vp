package ai.openbot.app.chat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeliverableResultGateTest {
  @Test
  fun acceptsDeclaredDeliverableEnvelope() {
    val artifact =
      mapOf(
        "provider" to "assistant-message",
        "providerMetadata" to mapOf("deliverableEnvelope" to true, "declared" to true),
        "artifactId" to "deliverable:output/a.md",
      )
    assertTrue(isDeliverableResultArtifact(artifact))
  }

  @Test
  fun rejectsInferredFile() {
    val artifact =
      mapOf(
        "provider" to "assistant-message",
        "providerMetadata" to mapOf("inferredFile" to true),
        "artifactId" to "assistant-doc:scraped.md",
      )
    assertFalse(isDeliverableResultArtifact(artifact))
  }

  @Test
  fun rejectsInferredDeliverable() {
    val artifact =
      mapOf(
        "provider" to "assistant-message",
        "providerMetadata" to mapOf("inferredDeliverable" to true),
        "artifactId" to "assistant-doc:plan.md",
      )
    assertFalse(isDeliverableResultArtifact(artifact))
  }

  @Test
  fun rejectsInferredDocumentBody() {
    val artifact =
      mapOf(
        "provider" to "assistant-message",
        "providerMetadata" to mapOf("inferredDocumentBody" to true),
        "artifactId" to "assistant-doc:article",
      )
    assertFalse(isDeliverableResultArtifact(artifact))
  }

  @Test
  fun rejectsPlainAssistantMessageWithoutDeclaration() {
    val artifact =
      mapOf(
        "provider" to "assistant-message",
        "artifactId" to "assistant-doc:note",
      )
    assertFalse(isDeliverableResultArtifact(artifact))
  }

  @Test
  fun acceptsWriteToolProvider() {
    val artifact =
      mapOf(
        "provider" to "tool-write",
        "artifactId" to "write:output/report.html",
      )
    assertTrue(isDeliverableResultArtifact(artifact))
  }

  @Test
  fun rejectsNull() {
    assertFalse(isDeliverableResultArtifact(null))
  }

  @Test
  fun proseFilenameMentionDoesNotCreateFooter() {
    // Planning prose / SKILL.md mentions must not chip — no tagged located envelope.
    val prose =
      """
      可以参考 SKILL.md 和 output/report.html 的写法，稍后再正式交付。
      """.trimIndent()
    assertTrue(extractLocatedDeliverableEnvelopes(prose).isEmpty())
    assertNullSafe(resolveDeliverableFooterEnvelope(prose))
  }

  private fun assertNullSafe(value: Any?) {
    org.junit.Assert.assertNull(value)
  }
}
