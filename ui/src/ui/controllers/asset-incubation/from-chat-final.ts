import type { ChatCapabilityEventPayload } from "../../capability/chat/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  decideAssetSuggestionFromChatFinal,
  type AssetSuggestionPatternRuntime,
} from "../asset-suggestion-trigger.ts";
import { ingestPatternSampleToServer } from "../pattern-detection.ts";
import { loadLocalEvidenceOverlay, mergeEvidenceLayers } from "./evidence-sync.ts";
import { buildPatternFingerprint } from "./pattern-fingerprint.ts";
import { maybeRecordSessionIncubationEvent } from "./record-session-event.ts";
import {
  deriveIncubationDecision,
  shouldShowSystemSuggestCta,
  shouldShowWeakHint,
} from "./scorer.ts";
import { sessionInputFromPatternHint } from "./session-bridge.ts";
import { projectedClusterRecurrenceCount } from "./session-event-store.ts";
import type { AssetIncubationDecision, AssetIncubationSource } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractMessageText(payload?: ChatCapabilityEventPayload): string {
  const record = asRecord(payload?.message);
  if (!record) {
    return "";
  }
  if (typeof record.text === "string") {
    return record.text.trim();
  }
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((entry) => {
      const part = asRecord(entry);
      return part?.type === "text" && typeof part.text === "string" ? part.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractHasArtifact(payload: ChatCapabilityEventPayload | undefined): boolean {
  const messageRecord = asRecord(payload?.message);
  return Boolean(stringValue(messageRecord?.artifactId));
}

function mapSuggestionSource(
  source: ReturnType<typeof decideAssetSuggestionFromChatFinal>["source"],
): AssetIncubationSource {
  if (source === "manual-iteration") {
    return "user-initiated";
  }
  return "session-detector";
}

/** @deprecated Session-scoped ingest; use cluster fingerprint recurrence instead. */
export function recurrenceCountFromRuntime(
  runtime: AssetSuggestionPatternRuntime | undefined,
  sessionKey: string,
): number {
  if (!runtime || !sessionKey.trim()) {
    return 0;
  }
  return runtime.ingestCountByScope.get(sessionKey) ?? 0;
}

export function projectedRecurrenceForFingerprint(clusterId: string, now = Date.now()): number {
  return projectedClusterRecurrenceCount(clusterId, now);
}

export function decideIncubationFromChatFinal(
  payload: ChatCapabilityEventPayload | undefined,
  runtime?: AssetSuggestionPatternRuntime,
  client?: GatewayBrowserClient | null,
): AssetIncubationDecision {
  const suggestion = decideAssetSuggestionFromChatFinal(payload, runtime);
  const sessionKey = stringValue(payload?.sessionKey);
  const hasArtifact = extractHasArtifact(payload);
  const sessionInput = sessionInputFromPatternHint(suggestion.hint, hasArtifact);
  const text = extractMessageText(payload);
  const fingerprint = buildPatternFingerprint({
    text,
    hasArtifact,
    hasStructuredOutput: sessionInput.hasStructuredOutput,
    hasWorkflowLanguage: sessionInput.hasWorkflowLanguage,
    signalKinds: (suggestion.hint?.signals ?? []).map((signal) => signal.kind),
  });
  const localEvidence = loadLocalEvidenceOverlay({
    clusterId: fingerprint.clusterId,
    contextId: suggestion.contextId,
    sessionKey,
    includePendingOccurrence: true,
  });
  const evidence = mergeEvidenceLayers({}, localEvidence, null);

  // Best-effort: push independent-run sample to server (authoritative multi-task evidence).
  // Fire-and-forget so UI path stays sync; server candidates feed subscribe/list.
  if (runtime?.state && payload?.state === "final" && text.trim()) {
    const agentId =
      suggestion.hint?.agentId ||
      (sessionKey.startsWith("space:") ? "group-supervisor" : "assistant-runtime");
    const inputStructureHash = fingerprint.intentKey || fingerprint.clusterId || "empty";
    const outputStructureHash =
      fingerprint.outputSchemaHash ?? fingerprint.clusterId ?? inputStructureHash;
    const toolNames = (suggestion.hint?.signals ?? [])
      .filter((signal) => signal.kind === "repeated_toolchain")
      .map((signal) => signal.description.trim())
      .filter(Boolean);
    void ingestPatternSampleToServer(runtime.state, {
      agentId,
      runId: stringValue(payload.runId) || null,
      taskId: stringValue(asRecord(payload.message)?.taskId) || null,
      sessionKey: sessionKey || null,
      inputStructureHash,
      outputStructureHash,
      toolTraceHash:
        fingerprint.workflowSignature !== "none" ? fingerprint.workflowSignature : null,
      toolsUsed: toolNames.length > 0 ? toolNames : null,
      success: true,
      suggestedNameHint: suggestion.hint?.suggestedName,
      suggestedSummaryHint: suggestion.hint?.suggestedSummary,
    }).catch(() => undefined);
  }

  const decision = deriveIncubationDecision({
    sessionInput,
    evidence,
    contextId: suggestion.contextId,
    source: mapSuggestionSource(suggestion.source),
  });
  maybeRecordSessionIncubationEvent({
    payload,
    hint: suggestion.hint,
    decision,
    client,
    fingerprint,
  });
  return decision;
}

export function shouldSurfaceSystemAssetSuggestion(decision: AssetIncubationDecision): boolean {
  return shouldShowSystemSuggestCta(decision);
}

export function shouldSurfaceWeakAssetHint(decision: AssetIncubationDecision): boolean {
  return shouldShowWeakHint(decision);
}

export {
  decideAssetSuggestionFromChatFinal,
  type AssetSuggestionPatternRuntime,
} from "../asset-suggestion-trigger.ts";
