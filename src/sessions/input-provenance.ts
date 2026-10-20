import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const INPUT_PROVENANCE_KIND_VALUES = [
  "external_user",
  "inter_session",
  "internal_system",
  "cron",
] as const;

export type InputProvenanceKind = (typeof INPUT_PROVENANCE_KIND_VALUES)[number];

export type InputProvenance = {
  kind: InputProvenanceKind;
  originSessionId?: string;
  sourceSessionKey?: string;
  sourceChannel?: string;
  sourceTool?: string;
  /** Platform-auth user id for tenant session-store routing on internal sends. */
  sourcePlatformUserId?: string;
  /** Display name of the sending digital human. Not the human who owns the session. */
  sourceSenderLabel?: string;
  cronJobId?: string;
  cronRunId?: string;
  cronJobName?: string;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isInputProvenanceKind(value: unknown): value is InputProvenanceKind {
  return (
    typeof value === "string" && (INPUT_PROVENANCE_KIND_VALUES as readonly string[]).includes(value)
  );
}

export function normalizeInputProvenance(value: unknown): InputProvenance | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isInputProvenanceKind(record.kind)) {
    return undefined;
  }
  return {
    kind: record.kind,
    originSessionId: normalizeOptionalString(record.originSessionId),
    sourceSessionKey: normalizeOptionalString(record.sourceSessionKey),
    sourceChannel: normalizeOptionalString(record.sourceChannel),
    sourceTool: normalizeOptionalString(record.sourceTool),
    sourcePlatformUserId: normalizeOptionalString(record.sourcePlatformUserId),
    sourceSenderLabel: normalizeOptionalString(record.sourceSenderLabel),
    cronJobId: normalizeOptionalString(record.cronJobId),
    cronRunId: normalizeOptionalString(record.cronRunId),
    cronJobName: normalizeOptionalString(record.cronJobName),
  };
}

export function applyInputProvenanceToUserMessage(
  message: AgentMessage,
  inputProvenance: InputProvenance | undefined,
): AgentMessage {
  if (!inputProvenance) {
    return message;
  }
  if ((message as { role?: unknown }).role !== "user") {
    return message;
  }
  const existing = normalizeInputProvenance((message as { provenance?: unknown }).provenance);
  if (existing) {
    return message;
  }
  const stamped: Record<string, unknown> = {
    ...(message as unknown as Record<string, unknown>),
    provenance: inputProvenance,
  };
  const speaker = inputProvenance.sourceSenderLabel?.trim();
  const existingSender = stamped.senderLabel;
  if (
    inputProvenance.kind === "inter_session" &&
    speaker &&
    (typeof existingSender !== "string" || !existingSender.trim())
  ) {
    stamped.senderLabel = speaker;
  }
  return stamped as unknown as AgentMessage;
}

export function isInterSessionInputProvenance(value: unknown): boolean {
  return normalizeInputProvenance(value)?.kind === "inter_session";
}

export function hasInterSessionUserProvenance(
  message: { role?: unknown; provenance?: unknown } | undefined,
): boolean {
  if (!message || message.role !== "user") {
    return false;
  }
  return isInterSessionInputProvenance(message.provenance);
}
