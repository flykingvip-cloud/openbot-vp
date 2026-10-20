import type { ChatCapabilityEventPayload } from "../../capability/chat/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import { syncSessionEventToGateway } from "./evidence-sync.ts";
import { buildPatternFingerprint } from "./pattern-fingerprint.ts";
import { sessionInputFromPatternHint } from "./session-bridge.ts";
import { sessionEventFromFingerprint } from "./session-event-store.ts";
import type { AssetIncubationDecision, PatternFingerprint } from "./types.ts";

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

export function maybeRecordSessionIncubationEvent(params: {
  payload: ChatCapabilityEventPayload | undefined;
  hint: { signals: Array<{ kind: string }>; suggestedName?: string } | null | undefined;
  decision: AssetIncubationDecision;
  client?: GatewayBrowserClient | null;
  fingerprint?: PatternFingerprint & {
    clusterId: string;
    intentKey: string;
    label: string;
    suggestedAssetType: import("../skill-models.ts").AssetType;
  };
}): void {
  if (params.payload?.state !== "final") {
    return;
  }
  const sessionKey = stringValue(params.payload.sessionKey);
  if (!sessionKey) {
    return;
  }
  if (params.decision.level === "L1" && params.decision.evidence.sessionQuality < 0.35) {
    return;
  }
  const messageRecord = asRecord(params.payload.message);
  const hasArtifact = Boolean(stringValue(messageRecord?.artifactId));
  const sessionInput = sessionInputFromPatternHint(params.hint as never, hasArtifact);
  const text = extractMessageText(params.payload);
  const fingerprint =
    params.fingerprint ??
    buildPatternFingerprint({
      text,
      hasArtifact,
      hasStructuredOutput: sessionInput.hasStructuredOutput,
      hasWorkflowLanguage: sessionInput.hasWorkflowLanguage,
      signalKinds: (params.hint?.signals ?? []).map((signal) => signal.kind),
    });
  const event = sessionEventFromFingerprint({
    sessionKey,
    contextId: params.decision.contextId,
    fingerprint,
    disambiguator: stringValue(asRecord(params.payload)?.runId),
  });
  void syncSessionEventToGateway(params.client ?? null, event);
}
