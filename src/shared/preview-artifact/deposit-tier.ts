export type ArtifactDepositTier = "high" | "low" | "none";

function providerMetadata(record: Record<string, unknown>): Record<string, unknown> | null {
  const meta = record.providerMetadata;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
}

function artifactProvider(artifact: Record<string, unknown>): string {
  return typeof artifact.provider === "string" ? artifact.provider.trim() : "";
}

function isWriteToolProvider(provider: string): boolean {
  return provider === "tool-write" || provider === "write-tool";
}

/** Classify whether an artifact should auto-surface deposit CTAs (high) or manual-only (low). */
export function classifyArtifactDepositTier(
  artifact: Record<string, unknown> | null | undefined,
): ArtifactDepositTier {
  if (!artifact) {
    return "none";
  }
  const provider = artifactProvider(artifact);
  const meta = providerMetadata(artifact);
  if (meta?.deliverableEnvelope === true) {
    return "high";
  }
  if (isWriteToolProvider(provider) || provider === "artifact-event") {
    return "high";
  }
  if (provider === "assistant-message") {
    return "low";
  }
  if (typeof artifact.artifactId === "string" && artifact.artifactId.startsWith("assistant-doc:")) {
    return "low";
  }
  return "none";
}

export function isHighConfidenceDepositArtifact(
  artifact: Record<string, unknown> | null | undefined,
): boolean {
  return classifyArtifactDepositTier(artifact) === "high";
}

/**
 * SoT for the chat 「打开成果」 affordance.
 *
 * A 成果 is a producer-declared deliverable (envelope / write-tool / artifact event)
 * or an explicit host artifact. Conversational mentions, scraped filenames, and
 * inferred article bodies stay in the chat lane and must not grow an open chip.
 */
export function isDeliverableResultArtifact(
  artifact: Record<string, unknown> | null | undefined,
): boolean {
  if (!artifact) {
    return false;
  }
  const meta = providerMetadata(artifact);
  if (
    meta?.inferredFile === true ||
    meta?.inferredDeliverable === true ||
    meta?.inferredDocumentBody === true
  ) {
    return false;
  }
  if (meta?.declared === true || meta?.deliverableEnvelope === true) {
    return true;
  }
  const provider = artifactProvider(artifact);
  if (isWriteToolProvider(provider) || provider === "artifact-event") {
    return true;
  }
  if (provider === "assistant-message") {
    return false;
  }
  const artifactId = typeof artifact.artifactId === "string" ? artifact.artifactId.trim() : "";
  if (!artifactId || artifactId.startsWith("assistant-doc:")) {
    return false;
  }
  return true;
}
