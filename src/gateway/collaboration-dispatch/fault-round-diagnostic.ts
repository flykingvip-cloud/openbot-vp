/**
 * Fault-round observability for collaboration / bot turns.
 *
 * Correlates Context Compiler telemetry with the turn's visible outcome
 * (silent suppress / NO_REPLY / empty / visible) so「代码仓排查错误」can
 * rebuild a single-round evidence chain without reading raw LLM payloads.
 *
 * Gated by collaboration.faultRoundObservability (default false).
 * Does not change Compiler windows, Scope defaults, or dispatch behavior.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContextCompileTelemetry,
  ContextDropReason,
} from "../../agents/context-compiler/types.js";
import type { OpenBotConfig } from "../../config/config.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { hashChatSessionKey } from "../chat-inbound-stage-events.js";
import { resolveContextScopePlan } from "../context-scope/controller.js";

const log = createSubsystemLogger("collab-fault-round");

export const COLLAB_FAULT_ROUND_EVENT = "collab.fault_round" as const;

export type FaultRoundVisibleOutcomeKind =
  | "visible"
  | "silent_suppress"
  | "no_reply"
  | "empty"
  | "skip";

export type FaultRoundVisibleOutcome = {
  kind: FaultRoundVisibleOutcomeKind;
  /** Present for silent_suppress / skip / empty / no_reply. */
  skipReason?: string;
  detail?: string;
};

export type FaultRoundCompilerSnapshot = {
  lane: string;
  unitCountBefore: number;
  unitCountAfter: number;
  admissionBudgetTokens: number;
  targetBudgetTokens: number;
  preCompileMessageCount: number;
  postCompileMessageCount: number;
  dropCount: number;
  dropReasons: ContextDropReason[];
  activeTaskPreserved?: boolean;
  currentTurnPreserved?: boolean;
};

export type CollabFaultRoundPartial = {
  runId: string;
  sessionKey?: string;
  groupId?: string;
  agentId?: string;
  /** Explicit inbound depth when known; omit or null when absent. */
  inboundDepth?: string | null;
  inboundDepthAbsent?: boolean;
  contextScopeMode?: string;
  compiler?: FaultRoundCompilerSnapshot;
  taskSummaryPresent?: boolean;
};

export type CollabFaultRoundDiagnostic = {
  event: typeof COLLAB_FAULT_ROUND_EVENT;
  runId: string;
  sessionKey?: string;
  sessionKeyHash?: string;
  groupId?: string;
  agentId?: string;
  /** From runtime build-info / OPENBOT_BUILD_SHA only — never invented. */
  buildSha?: string;
  inboundDepth: string | null;
  inboundDepthAbsent: boolean;
  contextScopeMode?: string;
  compiler?: FaultRoundCompilerSnapshot;
  taskSummaryPresent: boolean;
  outcome: FaultRoundVisibleOutcome;
  atMs: number;
};

const partialByRunId = new Map<string, CollabFaultRoundPartial>();
const MAX_PARTIALS = 256;

/** Test / reset helper. */
export function resetCollabFaultRoundPartialsForTests(): void {
  partialByRunId.clear();
}

export function isCollaborationFaultRoundObservabilityEnabled(cfg?: OpenBotConfig | null): boolean {
  if (cfg?.collaboration?.faultRoundObservability === true) {
    return true;
  }
  const raw = process.env.OPENBOT_COLLAB_FAULT_ROUND_OBS?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  return false;
}

/**
 * Soft-read LIVE-relevant git SHA from existing build-info paths / env.
 * Returns undefined when unavailable — never invents a SHA.
 */
export function readFaultRoundBuildShaSoft(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(here, "../../../dist/build-info.json"),
      path.join(process.cwd(), "dist/build-info.json"),
      path.join(process.cwd(), "build-info.json"),
    ];
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      try {
        const parsed = require(candidate) as { commit?: string | null };
        const commit = parsed.commit?.trim();
        if (commit) {
          return commit;
        }
      } catch {
        // try next
      }
    }
  } catch {
    // ignore
  }
  const fromEnv =
    process.env.OPENBOT_DIAGNOSIS_BUILD_SHA?.trim() || process.env.OPENBOT_BUILD_SHA?.trim() || "";
  return fromEnv || undefined;
}

export function compilerTelemetryToFaultRoundSnapshot(
  telemetry: ContextCompileTelemetry,
): FaultRoundCompilerSnapshot {
  const dropReasons = Array.isArray(telemetry.contextDropReasons)
    ? telemetry.contextDropReasons
    : [];
  return {
    lane: telemetry.lane,
    unitCountBefore: telemetry.unitCountBefore,
    unitCountAfter: telemetry.unitCountAfter,
    admissionBudgetTokens: telemetry.admissionBudgetTokens,
    targetBudgetTokens: telemetry.targetBudgetTokens,
    preCompileMessageCount: telemetry.preCompileMessageCount,
    postCompileMessageCount: telemetry.postCompileMessageCount,
    dropCount: dropReasons.length,
    dropReasons,
    activeTaskPreserved: telemetry.recallSafety?.activeTaskPreserved,
    currentTurnPreserved: telemetry.recallSafety?.currentTurnPreserved,
  };
}

function rememberPartial(partial: CollabFaultRoundPartial): void {
  const runId = partial.runId?.trim();
  if (!runId) {
    return;
  }
  const existing = partialByRunId.get(runId);
  const merged: CollabFaultRoundPartial = {
    ...(existing ?? { runId }),
    ...partial,
    runId,
    compiler: partial.compiler ?? existing?.compiler,
    taskSummaryPresent:
      partial.taskSummaryPresent !== undefined
        ? partial.taskSummaryPresent
        : existing?.taskSummaryPresent,
  };
  if (partialByRunId.size >= MAX_PARTIALS && !partialByRunId.has(runId)) {
    const oldest = partialByRunId.keys().next().value;
    if (oldest) {
      partialByRunId.delete(oldest);
    }
  }
  partialByRunId.set(runId, merged);
}

/**
 * Record compiler / depth / scope fields for a run. No-op when flag off.
 * Safe to call multiple times; later calls merge.
 */
export function recordCollabFaultRoundPartial(
  partial: CollabFaultRoundPartial,
  cfg?: OpenBotConfig | null,
): void {
  if (!isCollaborationFaultRoundObservabilityEnabled(cfg)) {
    return;
  }
  try {
    rememberPartial(partial);
  } catch {
    // never break the turn
  }
}

export function peekCollabFaultRoundPartialForTests(
  runId: string,
): CollabFaultRoundPartial | undefined {
  return partialByRunId.get(runId);
}

function resolveScopeModeForGroup(params: {
  groupId?: string;
  sessionKey?: string;
  inboundDepth?: string | null;
  recordedMode?: string;
}): string | undefined {
  if (params.recordedMode?.trim()) {
    return params.recordedMode.trim();
  }
  const groupId = params.groupId?.trim();
  const sessionKey = params.sessionKey?.trim();
  // Diagnostics must not invent session keys; without one, skip scope resolve.
  if (!groupId || !sessionKey) {
    return undefined;
  }
  const depth =
    params.inboundDepth === "chat" ||
    params.inboundDepth === "retrieve" ||
    params.inboundDepth === "act"
      ? params.inboundDepth
      : undefined;
  try {
    return resolveContextScopePlan({
      groupId,
      sessionKey,
      ...(depth ? { inboundDepth: depth } : {}),
    }).mode;
  } catch {
    return undefined;
  }
}

function buildDiagnostic(params: {
  runId: string;
  sessionKey?: string;
  groupId?: string;
  agentId?: string;
  inboundDepth?: string | null;
  inboundDepthAbsent?: boolean;
  contextScopeMode?: string;
  compiler?: FaultRoundCompilerSnapshot;
  taskSummaryPresent?: boolean;
  outcome: FaultRoundVisibleOutcome;
  atMs?: number;
}): CollabFaultRoundDiagnostic {
  const prior = partialByRunId.get(params.runId);
  const sessionKey = params.sessionKey?.trim() || prior?.sessionKey?.trim() || undefined;
  const groupId = params.groupId?.trim() || prior?.groupId?.trim() || undefined;
  const agentId = params.agentId?.trim() || prior?.agentId?.trim() || undefined;

  let inboundDepth: string | null =
    params.inboundDepth !== undefined
      ? params.inboundDepth
      : prior?.inboundDepth !== undefined
        ? prior.inboundDepth
        : null;
  const inboundDepthAbsent =
    params.inboundDepthAbsent === true ||
    prior?.inboundDepthAbsent === true ||
    inboundDepth == null ||
    inboundDepth === "";

  if (inboundDepthAbsent) {
    inboundDepth = null;
  }

  const contextScopeMode = resolveScopeModeForGroup({
    groupId,
    sessionKey,
    inboundDepth,
    recordedMode: params.contextScopeMode ?? prior?.contextScopeMode,
  });

  const compiler = params.compiler ?? prior?.compiler;
  const taskSummaryPresent =
    params.taskSummaryPresent !== undefined
      ? params.taskSummaryPresent
      : (prior?.taskSummaryPresent ?? false);

  const buildSha = readFaultRoundBuildShaSoft();

  return {
    event: COLLAB_FAULT_ROUND_EVENT,
    runId: params.runId,
    ...(sessionKey ? { sessionKey, sessionKeyHash: hashChatSessionKey(sessionKey) } : {}),
    ...(groupId ? { groupId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(buildSha ? { buildSha } : {}),
    inboundDepth,
    inboundDepthAbsent,
    ...(contextScopeMode ? { contextScopeMode } : {}),
    ...(compiler ? { compiler } : {}),
    taskSummaryPresent,
    outcome: params.outcome,
    atMs: params.atMs ?? Date.now(),
  };
}

/**
 * Emit one structured fault-round diagnostic for a finished bot/group turn.
 * No-op when flag off. Never throws.
 */
export function emitCollabFaultRoundDiagnostic(
  params: {
    runId: string;
    sessionKey?: string;
    groupId?: string;
    agentId?: string;
    inboundDepth?: string | null;
    inboundDepthAbsent?: boolean;
    contextScopeMode?: string;
    compiler?: FaultRoundCompilerSnapshot;
    taskSummaryPresent?: boolean;
    outcome: FaultRoundVisibleOutcome;
    atMs?: number;
  },
  cfg?: OpenBotConfig | null,
): CollabFaultRoundDiagnostic | null {
  if (!isCollaborationFaultRoundObservabilityEnabled(cfg)) {
    return null;
  }
  try {
    const diagnostic = buildDiagnostic(params);
    emitAgentEvent({
      runId: diagnostic.runId,
      stream: "lifecycle",
      sessionKey: diagnostic.sessionKey,
      data: {
        ...diagnostic,
        // Avoid duplicating full sessionKey in harvested extras when hash present.
      },
    });
    log.info("collab fault-round diagnostic", {
      runId: diagnostic.runId,
      groupId: diagnostic.groupId,
      agentId: diagnostic.agentId,
      sessionKeyHash: diagnostic.sessionKeyHash,
      buildSha: diagnostic.buildSha,
      inboundDepth: diagnostic.inboundDepth,
      inboundDepthAbsent: diagnostic.inboundDepthAbsent,
      contextScopeMode: diagnostic.contextScopeMode,
      taskSummaryPresent: diagnostic.taskSummaryPresent,
      outcomeKind: diagnostic.outcome.kind,
      skipReason: diagnostic.outcome.skipReason,
      compilerLane: diagnostic.compiler?.lane,
      unitCountBefore: diagnostic.compiler?.unitCountBefore,
      unitCountAfter: diagnostic.compiler?.unitCountAfter,
      dropCount: diagnostic.compiler?.dropCount,
      dropReasons: diagnostic.compiler?.dropReasons,
      admissionBudgetTokens: diagnostic.compiler?.admissionBudgetTokens,
    });
    partialByRunId.delete(params.runId);
    return diagnostic;
  } catch (err) {
    log.warn(`collab fault-round diagnostic emit failed: ${String(err)}`);
    return null;
  }
}

/** Map collaboration skipReason to a stable outcome kind. */
export function faultRoundOutcomeFromSkipReason(
  skipReason: string,
  detail?: string,
): FaultRoundVisibleOutcome {
  const reason = String(skipReason);
  if (reason === "silent" || reason === "duplicate") {
    return {
      kind: "silent_suppress",
      skipReason: reason,
      ...(detail?.trim() ? { detail: detail.trim() } : {}),
    };
  }
  if (reason === "empty") {
    return {
      kind: "empty",
      skipReason: reason,
      ...(detail?.trim() ? { detail: detail.trim() } : {}),
    };
  }
  // Missing reply classified as NO_REPLY token / paraphrases lands as silent today;
  // keep an explicit no_reply bucket when callers pass it.
  if (reason === "no_reply" || reason === "NO_REPLY") {
    return {
      kind: "no_reply",
      skipReason: reason,
      ...(detail?.trim() ? { detail: detail.trim() } : {}),
    };
  }
  return {
    kind: "skip",
    skipReason: reason,
    ...(detail?.trim() ? { detail: detail.trim() } : {}),
  };
}
