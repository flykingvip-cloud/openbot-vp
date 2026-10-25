/**
 * P0 single-chain protocol violation: detection facts, terminate signal, and
 * durable logging. Body protocol text must never become an executable tool call.
 *
 * Persistence sink (§7.3.B): `$STATE_DIR/logs/protocol-violations.jsonl`
 * Retention: same as other state logs; default keep 30 days (ops rotate).
 * Dedupe key: `runId + attemptOrTurnId + protocolKind + snippetHash`
 * eventId: SHA256 hex of the dedupe key (deterministic; never randomUUID per callback).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import type { ProtocolKind } from "./model-output-boundary.js";

export const PROTOCOL_VIOLATION_STOP_REASON = "protocol_violation" as const;

export const PROTOCOL_VIOLATION_SCHEMA_VERSION = 1 as const;

/** Closed recognition list — new kinds require list + tests (§7.3.A). */
export const PROTOCOL_RECOGNITION_CLOSED_LIST = {
  dsml_complete:
    "Complete DSML tool-call blocks already recognized by applyUserVisibleOutputGate (open/close tags).",
  dsml_incomplete:
    "Unclosed / truncated same-family DSML or special-token tails held by the streaming incomplete detector.",
  minimax_marked:
    "MiniMax XML cleanup only when text contains the agreed `minimax:tool_call` marker (display strip; never execute).",
  fenced_example:
    "Fenced code DSML examples: never execute; default not an execution-oriented violation (keep existing example boundary).",
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
  displayOutcome: "failure_copy" | "stripped_partial";
  /** True only when this response caused new tool execution from body (must stay false). */
  bodyDerivedToolExecution: false;
  /** Native structured calls on the same response (§7.3.C). */
  nativeExecutionStatus: NativeCallExecutionStatus;
  triggeredExtraModelTurn: false;
  terminated: boolean;
};

export type ProtocolBoundaryState = {
  /** Pure-body violation: skip auto-continue / repair. */
  terminated: boolean;
  lastFact: ProtocolViolationFact | null;
};

export function createProtocolBoundaryState(): ProtocolBoundaryState {
  return { terminated: false, lastFact: null };
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

const writtenDedupeKeys = new Set<string>();
let writeFailureCount = 0;

export function resetProtocolViolationPersistForTest(): void {
  writtenDedupeKeys.clear();
  writeFailureCount = 0;
}

export function getProtocolViolationWriteFailureCountForTest(): number {
  return writeFailureCount;
}

export function resolveProtocolViolationLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENBOT_PROTOCOL_VIOLATION_LOG?.trim();
  if (override) {
    return override;
  }
  return path.join(resolveStateDir(env), "logs", "protocol-violations.jsonl");
}

/**
 * Idempotent persist. Same dedupe key from stream/subscribe/display callbacks
 * writes once. Write failure never re-opens repair or re-prompts the model.
 */
export function persistProtocolViolationFact(
  fact: ProtocolViolationFact,
  opts?: { logPath?: string; env?: NodeJS.ProcessEnv },
): { written: boolean; duplicate: boolean; error?: string } {
  if (writtenDedupeKeys.has(fact.dedupeKey)) {
    return { written: false, duplicate: true };
  }
  writtenDedupeKeys.add(fact.dedupeKey);

  const logPath = opts?.logPath ?? resolveProtocolViolationLogPath(opts?.env);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(fact)}\n`, "utf8");
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
  displayOutcome: "failure_copy" | "stripped_partial";
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
