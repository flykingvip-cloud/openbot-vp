/**
 * Materialize declared <<DELIVERABLE file=/url=>> envelopes into structured
 * message.artifact(s) BEFORE control-channel display strip removes the tags.
 *
 * Chip SoT (`isDeliverableResultArtifact`) needs declared/deliverableEnvelope
 * metadata; visible markdown must stay tag-free after sanitize.
 */
import { isDeliverableResultArtifact } from "./deposit-tier.js";
import {
  withGeneratedPreviewArtifact,
  resolvePreviewArtifactRecords,
} from "./resolve-preview-artifact.js";

function providerMetadata(artifact: Record<string, unknown>): Record<string, unknown> | null {
  const meta = artifact.providerMetadata;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
}

export function isStructuredDeclaredDeliverableArtifact(
  artifact: Record<string, unknown> | null | undefined,
): boolean {
  if (!artifact) {
    return false;
  }
  const meta = providerMetadata(artifact);
  if (meta?.declared === true || meta?.deliverableEnvelope === true) {
    return true;
  }
  return isDeliverableResultArtifact(artifact);
}

function messageAlreadyHasDeclaredArtifact(message: Record<string, unknown>): boolean {
  if (
    message.artifact &&
    typeof message.artifact === "object" &&
    !Array.isArray(message.artifact) &&
    isStructuredDeclaredDeliverableArtifact(message.artifact as Record<string, unknown>)
  ) {
    return true;
  }
  if (Array.isArray(message.artifacts)) {
    return message.artifacts.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        isStructuredDeclaredDeliverableArtifact(entry as Record<string, unknown>),
    );
  }
  return false;
}

/**
 * Attach declared deliverable artifact(s) from raw assistant text.
 * No-op when tags are absent or a declared artifact is already present.
 */
export function attachDeclaredDeliverableArtifacts(
  message: Record<string, unknown>,
): Record<string, unknown> {
  if (messageAlreadyHasDeclaredArtifact(message)) {
    return message;
  }
  const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
  if (role && role !== "assistant") {
    return message;
  }
  return withGeneratedPreviewArtifact(message);
}

/** Build artifact field patch from raw text (for chat.final payloads). */
export function declaredDeliverableArtifactFields(
  text: string,
  opts?: { timestamp?: unknown; role?: string },
): { artifact?: Record<string, unknown>; artifacts?: Record<string, unknown>[] } {
  if (!text || !text.includes("DELIVERABLE")) {
    return {};
  }
  const message = withGeneratedPreviewArtifact({
    role: opts?.role ?? "assistant",
    content: [{ type: "text", text }],
    ...(opts?.timestamp !== undefined ? { timestamp: opts.timestamp } : { timestamp: Date.now() }),
  });
  const out: { artifact?: Record<string, unknown>; artifacts?: Record<string, unknown>[] } = {};
  if (
    message.artifact &&
    typeof message.artifact === "object" &&
    !Array.isArray(message.artifact)
  ) {
    const artifact = message.artifact as Record<string, unknown>;
    if (isStructuredDeclaredDeliverableArtifact(artifact)) {
      out.artifact = artifact;
    }
  }
  if (Array.isArray(message.artifacts) && message.artifacts.length > 0) {
    const artifacts = message.artifacts.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        isStructuredDeclaredDeliverableArtifact(entry as Record<string, unknown>),
    );
    if (artifacts.length > 0) {
      out.artifacts = artifacts;
      if (!out.artifact) {
        out.artifact = artifacts[0];
      }
    }
  }
  // Prefer records resolved directly when withGenerated kept an unrelated prior artifact.
  if (!out.artifact) {
    const resolved = resolvePreviewArtifactRecords({
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: opts?.timestamp ?? Date.now(),
    }).filter(isStructuredDeclaredDeliverableArtifact);
    if (resolved.length > 0) {
      out.artifact = resolved[0];
      if (resolved.length > 1) {
        out.artifacts = resolved;
      }
    }
  }
  return out;
}
