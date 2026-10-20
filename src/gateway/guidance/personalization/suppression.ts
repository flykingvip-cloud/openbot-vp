/**
 * Automatic guidance suppression & versioned re-entry (P2.3).
 * Gateway-owned — never browser localStorage as sole authority.
 * Keyed by tenantId + userId + scope + entityId.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../../infra/json-files.js";
import { CONFIG_DIR } from "../../../utils.js";
import { assertSafeProgressSegment, normalizeGuidanceProgressKey } from "../progress/keys.js";
import { sanitizeGuidanceProgressMetadata } from "../progress/redact.js";
import type { GuidanceProgressKey } from "../progress/types.js";
import { GuidanceProgressValidationError } from "../progress/types.js";

export const GUIDANCE_SUPPRESSION_VERSION = 1 as const;

/** Default: at most 3 auto-prompts per rolling 24h window. */
export const GUIDANCE_DEFAULT_MAX_PROMPTS_PER_WINDOW = 3;
export const GUIDANCE_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type GuidanceSuppressionRecord = GuidanceProgressKey & {
  version: typeof GUIDANCE_SUPPRESSION_VERSION;
  /** Product guidance content version — bump to allow versioned re-entry. */
  guidanceContentVersion: string;
  /** User globally dismissed auto guidance for this key. */
  globallySuppressed: boolean;
  globallySuppressedAt?: number;
  /** Auto-prompt timestamps within the current window (ms). */
  promptTimestampsMs: number[];
  /** Last known progress-ish outcome for re-entry rules (not Growth FSM). */
  lastOutcome?: "none" | "first_seen" | "completed" | "abandoned";
  lastOutcomeAt?: number;
  /** Content version that was completed/abandoned — re-enter when current differs. */
  outcomeContentVersion?: string;
  updatedAt: number;
  createdAt: number;
  /** Safe scalars only — no task body / secrets. */
  metadata?: Record<string, string | number | boolean | null>;
};

export type GuidanceSuppressionDecision = {
  allowAutoPrompt: boolean;
  reason:
    | "allowed_first"
    | "allowed_within_cap"
    | "allowed_version_reentry"
    | "suppressed_global"
    | "suppressed_frequency"
    | "suppressed_completed_same_version"
    | "suppressed_abandoned_same_version";
  record: GuidanceSuppressionRecord;
};

export type GuidanceSuppressionStore = {
  read(key: GuidanceProgressKey): Promise<GuidanceSuppressionRecord | null>;
  write(record: GuidanceSuppressionRecord): Promise<GuidanceSuppressionRecord>;
};

export type FileGuidanceSuppressionStoreOptions = {
  rootDir?: string;
};

const withLock = createAsyncLock();

export function resolveGuidanceSuppressionRoot(opts?: FileGuidanceSuppressionStoreOptions): string {
  return opts?.rootDir?.trim() || path.join(CONFIG_DIR, "guidance-suppression");
}

export function resolveGuidanceSuppressionPath(
  key: GuidanceProgressKey,
  opts?: FileGuidanceSuppressionStoreOptions,
): string {
  return path.join(
    resolveGuidanceSuppressionRoot(opts),
    key.tenantId,
    key.userId,
    key.scope,
    `${key.entityId}.json`,
  );
}

function isRecord(value: unknown): value is GuidanceSuppressionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return (
    raw.version === GUIDANCE_SUPPRESSION_VERSION &&
    typeof raw.tenantId === "string" &&
    typeof raw.userId === "string" &&
    typeof raw.scope === "string" &&
    typeof raw.entityId === "string" &&
    typeof raw.guidanceContentVersion === "string" &&
    typeof raw.globallySuppressed === "boolean" &&
    Array.isArray(raw.promptTimestampsMs)
  );
}

export function createFileGuidanceSuppressionStore(
  opts?: FileGuidanceSuppressionStoreOptions,
): GuidanceSuppressionStore {
  return {
    async read(key) {
      const parsed = await readJsonFile<unknown>(resolveGuidanceSuppressionPath(key, opts));
      if (!isRecord(parsed)) {
        return null;
      }
      if (
        parsed.tenantId !== key.tenantId ||
        parsed.userId !== key.userId ||
        parsed.scope !== key.scope ||
        parsed.entityId !== key.entityId
      ) {
        return null;
      }
      return parsed;
    },
    async write(record) {
      const filePath = resolveGuidanceSuppressionPath(record, opts);
      await withLock(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await writeJsonAtomic(filePath, record);
      });
      return record;
    },
  };
}

function emptyRecord(
  key: GuidanceProgressKey,
  guidanceContentVersion: string,
  nowMs: number,
): GuidanceSuppressionRecord {
  return {
    version: GUIDANCE_SUPPRESSION_VERSION,
    ...key,
    guidanceContentVersion,
    globallySuppressed: false,
    promptTimestampsMs: [],
    lastOutcome: "none",
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}

export type EvaluateGuidanceSuppressionInput = {
  key: GuidanceProgressKey;
  /** Current product guidance content version (e.g. "2026.09.03"). */
  guidanceContentVersion: string;
  nowMs?: number;
  maxPromptsPerWindow?: number;
  windowMs?: number;
};

/**
 * Pure decision given an existing record (or null). Does not write.
 *
 * Re-entry rules:
 * - first_seen / none → allow (subject to frequency + global suppress)
 * - completed + same content version → suppress auto
 * - abandoned + same content version → suppress auto
 * - completed/abandoned + different content version → allow versioned re-entry
 *   (clears global suppress for auto purposes when version changes)
 */
export function evaluateGuidanceSuppression(
  existing: GuidanceSuppressionRecord | null,
  input: EvaluateGuidanceSuppressionInput,
): GuidanceSuppressionDecision {
  const nowMs = input.nowMs ?? Date.now();
  const maxPrompts = input.maxPromptsPerWindow ?? GUIDANCE_DEFAULT_MAX_PROMPTS_PER_WINDOW;
  const windowMs = input.windowMs ?? GUIDANCE_DEFAULT_WINDOW_MS;
  const contentVersion = input.guidanceContentVersion.trim();
  if (!contentVersion) {
    throw new GuidanceProgressValidationError("guidanceContentVersion is required");
  }

  const base = existing ?? emptyRecord(input.key, contentVersion, nowMs);
  const versionChanged =
    Boolean(existing) &&
    (existing!.guidanceContentVersion !== contentVersion ||
      (existing!.outcomeContentVersion !== undefined &&
        existing!.outcomeContentVersion !== contentVersion));

  // Version bump clears stale global suppress for re-entry evaluation.
  const globallySuppressed = versionChanged ? false : base.globallySuppressed;
  const record: GuidanceSuppressionRecord = {
    ...base,
    ...input.key,
    guidanceContentVersion: contentVersion,
    globallySuppressed,
    promptTimestampsMs: (base.promptTimestampsMs ?? []).filter((ts) => nowMs - ts < windowMs),
    updatedAt: nowMs,
  };

  if (globallySuppressed) {
    return { allowAutoPrompt: false, reason: "suppressed_global", record };
  }

  const outcome = record.lastOutcome ?? "none";
  const outcomeVersion = record.outcomeContentVersion ?? record.guidanceContentVersion;
  if (outcome === "completed" && outcomeVersion === contentVersion && !versionChanged) {
    return { allowAutoPrompt: false, reason: "suppressed_completed_same_version", record };
  }
  if (outcome === "abandoned" && outcomeVersion === contentVersion && !versionChanged) {
    return { allowAutoPrompt: false, reason: "suppressed_abandoned_same_version", record };
  }

  if (record.promptTimestampsMs.length >= maxPrompts) {
    return { allowAutoPrompt: false, reason: "suppressed_frequency", record };
  }

  if (versionChanged && (outcome === "completed" || outcome === "abandoned")) {
    return { allowAutoPrompt: true, reason: "allowed_version_reentry", record };
  }
  if (!existing || outcome === "none" || outcome === "first_seen") {
    return {
      allowAutoPrompt: true,
      reason: existing ? "allowed_within_cap" : "allowed_first",
      record,
    };
  }
  return { allowAutoPrompt: true, reason: "allowed_within_cap", record };
}

export async function readGuidanceSuppressionDecision(
  store: GuidanceSuppressionStore,
  input: EvaluateGuidanceSuppressionInput,
): Promise<GuidanceSuppressionDecision> {
  const key = normalizeGuidanceProgressKey(input.key);
  const existing = await store.read(key);
  return evaluateGuidanceSuppression(existing, { ...input, key });
}

export async function recordGuidanceAutoPrompt(
  store: GuidanceSuppressionStore,
  input: EvaluateGuidanceSuppressionInput,
): Promise<GuidanceSuppressionDecision> {
  const decision = await readGuidanceSuppressionDecision(store, input);
  if (!decision.allowAutoPrompt) {
    return decision;
  }
  const nowMs = input.nowMs ?? Date.now();
  const record: GuidanceSuppressionRecord = {
    ...decision.record,
    promptTimestampsMs: [...decision.record.promptTimestampsMs, nowMs],
    lastOutcome:
      decision.record.lastOutcome === "none" ? "first_seen" : decision.record.lastOutcome,
    updatedAt: nowMs,
  };
  await store.write(record);
  return { ...decision, record };
}

export async function setGuidanceGlobalSuppression(
  store: GuidanceSuppressionStore,
  key: GuidanceProgressKey,
  params: {
    suppressed: boolean;
    guidanceContentVersion: string;
    nowMs?: number;
  },
): Promise<GuidanceSuppressionRecord> {
  const normalized = normalizeGuidanceProgressKey(key);
  assertSafeProgressSegment("entityId", normalized.entityId);
  const nowMs = params.nowMs ?? Date.now();
  const existing = await store.read(normalized);
  const record: GuidanceSuppressionRecord = {
    ...(existing ?? emptyRecord(normalized, params.guidanceContentVersion, nowMs)),
    ...normalized,
    guidanceContentVersion: params.guidanceContentVersion.trim(),
    globallySuppressed: params.suppressed,
    globallySuppressedAt: params.suppressed ? nowMs : undefined,
    updatedAt: nowMs,
  };
  return await store.write(record);
}

export async function markGuidanceSuppressionOutcome(
  store: GuidanceSuppressionStore,
  key: GuidanceProgressKey,
  params: {
    outcome: "completed" | "abandoned";
    guidanceContentVersion: string;
    nowMs?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<GuidanceSuppressionRecord> {
  const normalized = normalizeGuidanceProgressKey(key);
  const nowMs = params.nowMs ?? Date.now();
  const existing = await store.read(normalized);
  const record: GuidanceSuppressionRecord = {
    ...(existing ?? emptyRecord(normalized, params.guidanceContentVersion, nowMs)),
    ...normalized,
    guidanceContentVersion: params.guidanceContentVersion.trim(),
    lastOutcome: params.outcome,
    lastOutcomeAt: nowMs,
    outcomeContentVersion: params.guidanceContentVersion.trim(),
    metadata: sanitizeGuidanceProgressMetadata(params.metadata),
    updatedAt: nowMs,
  };
  return await store.write(record);
}
