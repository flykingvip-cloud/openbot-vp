import { isObjectiveShadowEnabled, readObjectiveShadowHmacKey } from "./feature.js";
import {
  appendShadowRecord,
  defaultObjectiveShadowLogPath,
  defaultObjectiveShadowWindowPath,
  findRecordByRunId,
  findSnapshotByRunId,
} from "./log.js";
import { observeObjective } from "./observe.js";
import { redactObserveInput } from "./redact.js";
import type { FrozenSnapshot, ShadowObserveInput, ShadowRuntimeResult } from "./types.js";
import { OBJECTIVE_SHADOW_SCHEMA } from "./types.js";
import {
  emptyWindowState,
  isWindowClosed,
  readWindowState,
  recordSuccessfulWrite,
  writeWindowState,
  type ShadowWindowState,
} from "./window.js";
import { getDefaultWriteGuard, type ForbiddenWriteGuard } from "./write-guard.js";

export type ObjectiveShadowDeps = {
  env?: NodeJS.ProcessEnv;
  nowMs?: () => number;
  logPath?: string;
  windowPath?: string;
  writeGuard?: ForbiddenWriteGuard;
  parentLookup?: (runId: string) => FrozenSnapshot | undefined;
  /** When true, observe in memory but never append JSONL (replay). */
  replay?: boolean;
};

export function storeNowMs(): number {
  return Date.now();
}

function loadWindow(windowPath: string): ShadowWindowState {
  return readWindowState(windowPath);
}

export function maybeObserveObjectiveShadow(
  input: ShadowObserveInput,
  deps: ObjectiveShadowDeps = {},
): ShadowRuntimeResult {
  const env = deps.env ?? process.env;
  const guard = deps.writeGuard ?? getDefaultWriteGuard();
  const nowMs = deps.nowMs ?? storeNowMs;
  const observedAtMs = nowMs();

  if (!isObjectiveShadowEnabled(env)) {
    return { enabled: false, wrote: false };
  }

  const hmacKey = readObjectiveShadowHmacKey(env);
  if (!hmacKey) {
    return { enabled: true, wrote: false, reason: "hmac_key_missing" };
  }

  if (input.schemaVersion !== OBJECTIVE_SHADOW_SCHEMA || !input.runId || !input.ingress) {
    return { enabled: true, wrote: false, reason: "invalid_input" };
  }

  const logPath = deps.logPath ?? defaultObjectiveShadowLogPath();
  const windowPath = deps.windowPath ?? defaultObjectiveShadowWindowPath(logPath);
  const windowState = deps.replay ? emptyWindowState() : loadWindow(windowPath);

  if (windowState.stopped || guard.attempts > 0) {
    windowState.stopped = true;
    if (!deps.replay) {
      writeWindowState(windowPath, windowState);
    }
    return { enabled: true, wrote: false, reason: "stopped" };
  }

  if (isWindowClosed(windowState, input.ingress, observedAtMs)) {
    const redacted = redactObserveInput(input, hmacKey);
    const parentSnapshot =
      input.ingress === "subagent" && input.parentRunId
        ? (deps.parentLookup?.(input.parentRunId) ??
          findSnapshotByRunId(logPath, input.parentRunId))
        : undefined;
    const record = observeObjective(
      { ...input, candidates: redacted.candidates, observedAtMs },
      {
        tenantHash: redacted.tenantHash,
        groupHash: redacted.groupHash,
        nowMs: observedAtMs,
        parentSnapshot,
        redactionDropped: redacted.redactionDropped,
        forbiddenWriteAttempts: guard.attempts > 0 ? 1 : 0,
      },
    );
    record.rejectOrDiscardCodes = record.rejectOrDiscardCodes.includes("window_closed")
      ? record.rejectOrDiscardCodes
      : [...record.rejectOrDiscardCodes, "window_closed"];
    record.proposed = [];
    record.proposedDisposition = "discarded";
    return { enabled: true, wrote: false, record, reason: "window_closed" };
  }

  if (!deps.replay) {
    const existing = findRecordByRunId(logPath, input.runId);
    if (existing) {
      return { enabled: true, wrote: false, record: existing, reason: "idempotent" };
    }
    if (windowState.seenRunIds.includes(input.runId)) {
      return { enabled: true, wrote: false, reason: "idempotent" };
    }
  }

  const redacted = redactObserveInput(input, hmacKey);
  const parentSnapshot =
    input.ingress === "subagent" && input.parentRunId
      ? (deps.parentLookup?.(input.parentRunId) ?? findSnapshotByRunId(logPath, input.parentRunId))
      : undefined;

  const record = observeObjective(
    { ...input, candidates: redacted.candidates, observedAtMs },
    {
      tenantHash: redacted.tenantHash,
      groupHash: redacted.groupHash,
      nowMs: observedAtMs,
      parentSnapshot,
      redactionDropped: redacted.redactionDropped,
      forbiddenWriteAttempts: 0,
    },
  );

  if (deps.replay) {
    return { enabled: true, wrote: false, record, reason: "replay" };
  }

  appendShadowRecord(logPath, record);
  writeWindowState(
    windowPath,
    recordSuccessfulWrite(windowState, input.ingress, input.runId, observedAtMs),
  );
  return { enabled: true, wrote: true, record };
}

/** Fire-and-forget ingress hook. Never throws; return value must not affect the run. */
export function tryObserveObjectiveShadow(
  input: ShadowObserveInput,
  deps: ObjectiveShadowDeps = {},
): void {
  try {
    maybeObserveObjectiveShadow(input, deps);
  } catch {
    // I14: shadow must not change prompt / completion / run status.
  }
}
