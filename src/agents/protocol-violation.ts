/**
 * P0 single-chain protocol violation: detection facts, terminate signal, and
 * durable logging. Body protocol text must never become an executable tool call.
 *
 * Persistence sink (§7.3.B): `$STATE_DIR/logs/protocol-violations.jsonl`
 * (override: `OPENBOT_PROTOCOL_VIOLATION_LOG`).
 *
 * Retention: this module does **not** self-rotate. Ops rotate/prune the sink
 * with the same state-log retention used for other `$STATE_DIR/logs/*.jsonl`
 * files (repo ops default ~30 days). Set `OPENBOT_PROTOCOL_VIOLATION_LOG` to
 * point at a path already covered by that rotation. There is no separate
 * in-process 30-day timer.
 *
 * Dedupe key: `runId + attemptOrTurnId + protocolKind + snippetHash`
 * eventId: SHA256 hex of the dedupe key (deterministic; never randomUUID per callback).
 * Mark written **only after** successful append; failed writes stay retryable.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import type { ProtocolKind } from "./model-output-boundary.js";

export const PROTOCOL_VIOLATION_STOP_REASON = "protocol_violation" as const;

export const PROTOCOL_VIOLATION_SCHEMA_VERSION = 1 as const;

/** Soft cap for process-local successful-write dedupe cache (§7.3.B). */
export const PROTOCOL_VIOLATION_DEDUPE_CACHE_LIMIT = 4_096;

/** Closed recognition list — new kinds require list + tests (§7.3.A). */
export const PROTOCOL_RECOGNITION_CLOSED_LIST = {
  dsml_complete:
    "Complete DSML tool-call blocks already recognized by applyUserVisibleOutputGate (open/close tags).",
  dsml_incomplete:
    "Unclosed / truncated same-family DSML or special-token tails held by the streaming incomplete detector.",
  minimax_marked:
    "MiniMax XML only when text contains the agreed `minimax:tool_call` marker — detected by applyUserVisibleOutputGate (never execute).",
  fenced_example:
    "Fenced code DSML/MiniMax examples: never execute; default not an execution-oriented violation (keep existing example boundary).",
  excluded:
    "Ordinary word `invoke`, bare `<` comparisons, arbitrary XML/HTML without agreed markers — must NOT count as violation.",
} as const;

export type NativeCallExecutionStatus = "none" | "requested" | "rejected" | "executed";

export type ProtocolViolationClassification =
  | "pure_body"
  | "mixed_native_and_body"
  | "incomplete_body"
  | "unknown_tool_name_in_body"
  | "no_tools_available";

export type ProtocolViolationFact = {
  schemaVersion: typeof PROTOCOL_VIOLATION_SCHEMA_VERSION;
  eventId: string;
  dedupeKey: string;
  ts: number;
  runId: string;
  attemptOrTurnId: string;
  sessionId?: string;
  agentId?: string;
  provider?: string;
  model?: string;
  protocol: ProtocolKind | null;
  classification: ProtocolViolationClassification;
  allowedToolNames: string[];
  detectedToolNames: string[];
  snippetHash: string;
  snippetLength: number;
  displayOutcome: "failure_copy" | "stripped_partial" | "stripped_empty";
  bodyDerivedToolExecution: false;
  nativeExecutionStatus: NativeCallExecutionStatus;
  triggeredExtraModelTurn: false;
  terminated: boolean;
};

export type NativeCallOutcomeFact = {
  schemaVersion: typeof PROTOCOL_VIOLATION_SCHEMA_VERSION;
  event: "protocol_violation_native_outcome";
  eventId: string;
  parentEventId: string;
  dedupeKey: string;
  ts: number;
  runId: string;
  status: "rejected" | "executed";
  toolName?: string;
  toolCallId?: string;
};

export type ProtocolBoundaryState = {
  terminated: boolean;
  lastFact: ProtocolViolationFact | null;
  attemptId: string;
  modelResponseSeq: number;
};

export function createProtocolBoundaryState(attemptId = "attempt"): ProtocolBoundaryState {
  return { terminated: false, lastFact: null, attemptId, modelResponseSeq: 0 };
}

export function allocateModelResponseAttemptId(state: ProtocolBoundaryState): string {
  state.modelResponseSeq += 1;
  return `${state.attemptId}:mr${state.modelResponseSeq}`;
}

export function buildProtocolViolationDedupeKey(parts: {
  runId: string;
  attemptOrTurnId: string;
  protocolKind: string;
  snippetHash: string;
}): string {
  return [parts.runId, parts.attemptOrTurnId, parts.protocolKind, parts.snippetHash].join("|");
}

export function eventIdFromDedupeKey(dedupeKey: string): string {
  return createHash("sha256").update(dedupeKey).digest("hex");
}

export function hashProtocolSnippet(text: string): { snippetHash: string; snippetLength: number } {
  const normalized = text ?? "";
  return {
    snippetHash: createHash("sha256").update(normalized).digest("hex").slice(0, 32),
    snippetLength: normalized.length,
  };
}

const writtenDedupeKeys = new Map<string, number>();
let writeFailureCount = 0;
let dedupeInsertSeq = 0;

export function resetProtocolViolationPersistForTest(): void {
  writtenDedupeKeys.clear();
  writeFailureCount = 0;
  dedupeInsertSeq = 0;
}

export function getProtocolViolationWriteFailureCountForTest(): number {
  return writeFailureCount;
}

export function getProtocolViolationDedupeCacheSizeForTest(): number {
  return writtenDedupeKeys.size;
}

function rememberSuccessfulWrite(dedupeKey: string): void {
  if (writtenDedupeKeys.has(dedupeKey)) {
    return;
  }
  dedupeInsertSeq += 1;
  writtenDedupeKeys.set(dedupeKey, dedupeInsertSeq);
  while (writtenDedupeKeys.size > PROTOCOL_VIOLATION_DEDUPE_CACHE_LIMIT) {
    const oldest = writtenDedupeKeys.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    writtenDedupeKeys.delete(oldest);
  }
}

export function resolveProtocolViolationLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENBOT_PROTOCOL_VIOLATION_LOG?.trim();
  if (override) {
    return override;
  }
  return path.join(resolveStateDir(env), "logs", "protocol-violations.jsonl");
}

export function persistProtocolViolationFact(
  fact: ProtocolViolationFact,
  opts?: { logPath?: string; env?: NodeJS.ProcessEnv },
): { written: boolean; duplicate: boolean; error?: string } {
  if (writtenDedupeKeys.has(fact.dedupeKey)) {
    return { written: false, duplicate: true };
  }

  const logPath = opts?.logPath ?? resolveProtocolViolationLogPath(opts?.env);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(fact)}\n`, "utf8");
    rememberSuccessfulWrite(fact.dedupeKey);
    return { written: true, duplicate: false };
  } catch (err) {
    writeFailureCount += 1;
    const message = err instanceof Error ? err.message : String(err);
    try {
      emitAgentEvent({
        runId: fact.runId,
        stream: "error",
        data: {
          event: "protocol_violation_persist_failed",
          dedupeKey: fact.dedupeKey,
          error: message,
          writeFailureCount,
        },
      });
    } catch {
      // ignore fan-out failure
    }
    return { written: false, duplicate: false, error: message };
  }
}

export function buildProtocolViolationFact(input: {
  runId: string;
  attemptOrTurnId: string;
  sessionId?: string;
  agentId?: string;
  provider?: string;
  model?: string;
  protocol: ProtocolKind | null;
  classification: ProtocolViolationClassification;
  allowedToolNames: Iterable<string>;
  detectedToolNames: string[];
  rawText: string;
  displayOutcome: "failure_copy" | "stripped_partial" | "stripped_empty";
  nativeExecutionStatus: NativeCallExecutionStatus;
  terminated: boolean;
}): ProtocolViolationFact {
  const { snippetHash, snippetLength } = hashProtocolSnippet(input.rawText);
  const protocolKind = input.protocol ?? "unknown";
  const dedupeKey = buildProtocolViolationDedupeKey({
    runId: input.runId,
    attemptOrTurnId: input.attemptOrTurnId,
    protocolKind,
    snippetHash,
  });
  return {
    schemaVersion: PROTOCOL_VIOLATION_SCHEMA_VERSION,
    eventId: eventIdFromDedupeKey(dedupeKey),
    dedupeKey,
    ts: Date.now(),
    runId: input.runId,
    attemptOrTurnId: input.attemptOrTurnId,
    sessionId: input.sessionId,
    agentId: input.agentId,
    provider: input.provider,
    model: input.model,
    protocol: input.protocol,
    classification: input.classification,
    allowedToolNames: [...input.allowedToolNames].toSorted(),
    detectedToolNames: [...input.detectedToolNames],
    snippetHash,
    snippetLength,
    displayOutcome: input.displayOutcome,
    bodyDerivedToolExecution: false,
    nativeExecutionStatus: input.nativeExecutionStatus,
    triggeredExtraModelTurn: false,
    terminated: input.terminated,
  };
}

export function buildNativeCallOutcomeFact(input: {
  parentEventId: string;
  runId: string;
  status: "rejected" | "executed";
  toolName?: string;
  toolCallId?: string;
}): NativeCallOutcomeFact {
  const dedupeKey = [
    "native_outcome",
    input.parentEventId,
    input.toolCallId ?? input.toolName ?? "",
    input.status,
  ].join("|");
  return {
    schemaVersion: PROTOCOL_VIOLATION_SCHEMA_VERSION,
    event: "protocol_violation_native_outcome",
    eventId: eventIdFromDedupeKey(dedupeKey),
    parentEventId: input.parentEventId,
    dedupeKey,
    ts: Date.now(),
    runId: input.runId,
    status: input.status,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
  };
}

export function persistNativeCallOutcomeFact(
  fact: NativeCallOutcomeFact,
  opts?: { logPath?: string; env?: NodeJS.ProcessEnv },
): { written: boolean; duplicate: boolean; error?: string } {
  if (writtenDedupeKeys.has(fact.dedupeKey)) {
    return { written: false, duplicate: true };
  }
  const logPath = opts?.logPath ?? resolveProtocolViolationLogPath(opts?.env);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(fact)}\n`, "utf8");
    rememberSuccessfulWrite(fact.dedupeKey);
    return { written: true, duplicate: false };
  } catch (err) {
    writeFailureCount += 1;
    const message = err instanceof Error ? err.message : String(err);
    try {
      emitAgentEvent({
        runId: fact.runId,
        stream: "error",
        data: {
          event: "protocol_violation_persist_failed",
          dedupeKey: fact.dedupeKey,
          error: message,
          writeFailureCount,
        },
      });
    } catch {
      // ignore
    }
    return { written: false, duplicate: false, error: message };
  }
}

export function linkNativeOutcomesForViolation(params: {
  parentFact: ProtocolViolationFact | null | undefined;
  runId: string;
  tools: ReadonlyArray<{ toolName: string; toolCallId?: string; success?: boolean }>;
  logPath?: string;
}): number {
  const parent = params.parentFact;
  if (!parent || parent.nativeExecutionStatus !== "requested") {
    return 0;
  }
  let written = 0;
  for (const tool of params.tools) {
    const fact = buildNativeCallOutcomeFact({
      parentEventId: parent.eventId,
      runId: params.runId,
      status: tool.success === false ? "rejected" : "executed",
      toolName: tool.toolName,
      toolCallId: tool.toolCallId,
    });
    const result = persistNativeCallOutcomeFact(fact, { logPath: params.logPath });
    if (result.written) {
      written += 1;
    }
  }
  return written;
}

export function isProtocolViolationStopReason(stopReason: unknown): boolean {
  return stopReason === PROTOCOL_VIOLATION_STOP_REASON;
}

export function lastAssistantHasProtocolViolation(messages: readonly unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const rec = message as { role?: unknown; stopReason?: unknown };
    if (rec.role !== "assistant") {
      continue;
    }
    return isProtocolViolationStopReason(rec.stopReason);
  }
  return false;
}

export function isProtocolViolationContinueBlocked(params: {
  boundaryTerminated?: boolean;
  messages?: readonly unknown[];
}): boolean {
  if (params.boundaryTerminated) {
    return true;
  }
  if (params.messages && lastAssistantHasProtocolViolation(params.messages)) {
    return true;
  }
  return false;
}
