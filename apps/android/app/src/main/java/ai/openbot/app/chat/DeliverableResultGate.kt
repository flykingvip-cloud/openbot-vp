package ai.openbot.app.chat

/**
 * SoT port of Web `isDeliverableResultArtifact` (deposit-tier.ts).
 *
 * A 成果 is producer-declared (envelope / write-tool / artifact-event) or an explicit
 * host artifact. Inferred scrapes must never grow an 「打开成果」 chip.
 */

private fun providerMetadata(record: Map<String, Any?>): Map<String, Any?>? {
  val meta = record["providerMetadata"]
  @Suppress("UNCHECKED_CAST")
  return if (meta is Map<*, *>) meta as Map<String, Any?> else null
}

private fun artifactProvider(artifact: Map<String, Any?>): String {
  val provider = artifact["provider"]
  return if (provider is String) provider.trim() else ""
}

private fun isWriteToolProvider(provider: String): Boolean =
  provider == "tool-write" || provider == "write-tool"

/**
 * Gate for chat 「打开成果」 affordance on artifact-shaped records.
 * Rejects inferredFile / inferredDeliverable / inferredDocumentBody.
 */
fun isDeliverableResultArtifact(artifact: Map<String, Any?>?): Boolean {
  if (artifact == null) return false
  val meta = providerMetadata(artifact)
  if (
    meta?.get("inferredFile") == true ||
      meta?.get("inferredDeliverable") == true ||
      meta?.get("inferredDocumentBody") == true
  ) {
    return false
  }
  if (meta?.get("declared") == true || meta?.get("deliverableEnvelope") == true) {
    return true
  }
  val provider = artifactProvider(artifact)
  if (isWriteToolProvider(provider) || provider == "artifact-event") {
    return true
  }
  if (provider == "assistant-message") {
    return false
  }
  val artifactId = (artifact["artifactId"] as? String)?.trim().orEmpty()
  if (artifactId.isEmpty() || artifactId.startsWith("assistant-doc:")) {
    return false
  }
  return true
}

/**
 * Stage 25 chat MVP: show a single footer only for a **located** tagged envelope
 * that passes the declared-deliverable gate (never inferred).
 *
 * - neither file nor url → null (no footer)
 * - file-only / url / both → envelope (UI disables open when file-only & no workspace path)
 */
fun resolveDeliverableFooterEnvelope(assistantText: String): DeliverableEnvelope? {
  val located = extractLocatedDeliverableEnvelopes(assistantText)
  val envelope = when {
    located.isEmpty() -> return null
    located.size == 1 -> located[0]
    else -> located.first() // MVP: single footer chip; first located wins
  }
  // Declared envelope ≡ deliverableEnvelope metadata on Web.
  val artifact =
    mapOf(
      "provider" to "assistant-message",
      "providerMetadata" to
        mapOf(
          "deliverableEnvelope" to true,
          "declared" to true,
        ),
      "artifactId" to "deliverable:${envelope.file ?: envelope.url}",
    )
  return if (isDeliverableResultArtifact(artifact)) envelope else null
}

/** True when footer CTA can open (http/https url present). File-only stays disabled. */
fun deliverableOpenEnabled(envelope: DeliverableEnvelope): Boolean =
  !envelope.url.isNullOrBlank()
