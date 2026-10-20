/**
 * Idempotent progress operations: read / upsert / advance / abandon.
 */

import type { GuidanceConfidence } from "../types.js";
import { assertProgressRecordMatchesKey } from "./authorize.js";
import { redactOptionalProgressText, sanitizeGuidanceProgressMetadata } from "./redact.js";
import type {
  GuidanceProgressAbandonInput,
  GuidanceProgressAdvanceInput,
  GuidanceProgressKey,
  GuidanceProgressRecord,
  GuidanceProgressStore,
  GuidanceProgressUpsertInput,
} from "./types.js";
import { GUIDANCE_PROGRESS_VERSION, GuidanceProgressValidationError } from "./types.js";

/** Default retention: 90 days from last touch. */
export const GUIDANCE_PROGRESS_DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function assertConfidence(value: unknown): GuidanceConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  throw new GuidanceProgressValidationError("confidence must be high|medium|low");
}

function requireNonEmpty(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new GuidanceProgressValidationError(`${label} is required`);
  }
  return trimmed;
}

export function isGuidanceProgressExpired(
  record: GuidanceProgressRecord,
  nowMs: number = Date.now(),
): boolean {
  return typeof record.expiresAt === "number" && record.expiresAt <= nowMs;
}

function defaultExpiresAt(nowMs: number, explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > nowMs) {
    return explicit;
  }
  return nowMs + GUIDANCE_PROGRESS_DEFAULT_RETENTION_MS;
}

export async function readGuidanceProgress(
  store: GuidanceProgressStore,
  key: GuidanceProgressKey,
  opts?: { nowMs?: number; purgeExpired?: boolean },
): Promise<GuidanceProgressRecord | null> {
  const nowMs = opts?.nowMs ?? Date.now();
  const record = await store.read(key);
  if (!record) {
    return null;
  }
  assertProgressRecordMatchesKey(record, key);
  if (isGuidanceProgressExpired(record, nowMs)) {
    if (opts?.purgeExpired !== false) {
      await store.delete(key);
    }
    return null;
  }
  return record;
}

export async function upsertGuidanceProgress(
  store: GuidanceProgressStore,
  key: GuidanceProgressKey,
  input: GuidanceProgressUpsertInput,
): Promise<GuidanceProgressRecord> {
  const nowMs = input.nowMs ?? Date.now();
  const scenario = requireNonEmpty("scenario", input.scenario);
  const currentStage = requireNonEmpty("currentStage", input.currentStage);
  const nextActionKind = requireNonEmpty("nextActionKind", input.nextActionKind);
  const confidence = assertConfidence(input.confidence);
  const completedSteps = Array.isArray(input.completedSteps)
    ? [...new Set(input.completedSteps.map((s) => s.trim()).filter(Boolean))]
    : [];
  const status = input.status ?? "active";
  if (status !== "active" && status !== "completed") {
    throw new GuidanceProgressValidationError("upsert status must be active|completed");
  }

  const existing = await readGuidanceProgress(store, key, { nowMs, purgeExpired: true });

  // Idempotent: identical active payload → return existing without bumping clocks.
  if (
    existing &&
    existing.status === status &&
    existing.scenario === scenario &&
    existing.currentStage === currentStage &&
    existing.nextActionKind === nextActionKind &&
    existing.confidence === confidence &&
    existing.completedSteps.join("\0") === completedSteps.join("\0") &&
    (input.failureCount === undefined || existing.failureCount === input.failureCount) &&
    (input.nextActionLabel === undefined ||
      existing.nextActionLabel === redactOptionalProgressText(input.nextActionLabel))
  ) {
    return existing;
  }

  const createdAt = existing?.createdAt ?? nowMs;
  const failureCount =
    typeof input.failureCount === "number" && Number.isFinite(input.failureCount)
      ? Math.max(0, Math.floor(input.failureCount))
      : (existing?.failureCount ?? 0);

  const record: GuidanceProgressRecord = {
    version: GUIDANCE_PROGRESS_VERSION,
    ...key,
    scenario,
    currentStage,
    completedSteps,
    nextActionKind,
    nextActionLabel: redactOptionalProgressText(input.nextActionLabel),
    confidence,
    failureCount,
    status,
    abandonedAt: undefined,
    completedAt: status === "completed" ? nowMs : undefined,
    lastSeenAt: nowMs,
    createdAt,
    updatedAt: nowMs,
    lastGuidanceEventId: input.lastGuidanceEventId?.trim() || existing?.lastGuidanceEventId,
    lastGuidanceEventType: input.lastGuidanceEventType ?? existing?.lastGuidanceEventType,
    metadata: sanitizeGuidanceProgressMetadata(input.metadata) ?? existing?.metadata,
    expiresAt: defaultExpiresAt(nowMs, input.expiresAt),
  };

  return await store.write(record);
}

export async function advanceGuidanceProgress(
  store: GuidanceProgressStore,
  key: GuidanceProgressKey,
  input: GuidanceProgressAdvanceInput,
): Promise<GuidanceProgressRecord> {
  const nowMs = input.nowMs ?? Date.now();
  const stepId = requireNonEmpty("stepId", input.stepId);
  const existing = await readGuidanceProgress(store, key, { nowMs, purgeExpired: true });
  if (!existing || existing.status !== "active") {
    throw new GuidanceProgressValidationError("no active guidance progress to advance");
  }

  const alreadyDone = existing.completedSteps.includes(stepId);
  const nextStage = input.nextStage?.trim() || existing.currentStage;
  const nextActionKind = input.nextActionKind?.trim() || existing.nextActionKind;
  const nextActionLabel =
    input.nextActionLabel !== undefined
      ? redactOptionalProgressText(input.nextActionLabel)
      : existing.nextActionLabel;
  const confidence = input.confidence ? assertConfidence(input.confidence) : existing.confidence;

  // Idempotent re-advance of the same step with same stage/action.
  if (
    alreadyDone &&
    existing.currentStage === nextStage &&
    existing.nextActionKind === nextActionKind &&
    existing.confidence === confidence
  ) {
    return existing;
  }

  const completedSteps = alreadyDone
    ? existing.completedSteps
    : [...existing.completedSteps, stepId];

  const record: GuidanceProgressRecord = {
    ...existing,
    currentStage: nextStage,
    completedSteps,
    nextActionKind,
    nextActionLabel,
    confidence,
    lastSeenAt: nowMs,
    updatedAt: nowMs,
    metadata: sanitizeGuidanceProgressMetadata(input.metadata) ?? existing.metadata,
    expiresAt: defaultExpiresAt(nowMs, existing.expiresAt),
  };
  return await store.write(record);
}

export async function abandonGuidanceProgress(
  store: GuidanceProgressStore,
  key: GuidanceProgressKey,
  input: GuidanceProgressAbandonInput = {},
): Promise<GuidanceProgressRecord> {
  const nowMs = input.nowMs ?? Date.now();
  const existing = await readGuidanceProgress(store, key, { nowMs, purgeExpired: true });
  if (!existing) {
    throw new GuidanceProgressValidationError("no guidance progress to abandon");
  }
  if (existing.status === "abandoned") {
    return existing; // idempotent
  }

  const reason = redactOptionalProgressText(input.reason);
  const metadata = {
    ...sanitizeGuidanceProgressMetadata(existing.metadata),
    ...sanitizeGuidanceProgressMetadata(input.metadata),
    ...(reason ? { abandonReason: reason } : {}),
  };

  const record: GuidanceProgressRecord = {
    ...existing,
    status: "abandoned",
    abandonedAt: nowMs,
    lastSeenAt: nowMs,
    updatedAt: nowMs,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    expiresAt: defaultExpiresAt(nowMs, existing.expiresAt),
  };
  return await store.write(record);
}
