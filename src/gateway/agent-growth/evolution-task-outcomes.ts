import fs from "node:fs";
import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  logEvolutionLoop,
  reportEvolutionOutcomeWriteFailure,
} from "../evolution-control/evolution-loop-log.js";
import { issueRuntimeOwnershipProof } from "../evolution-control/runtime-ownership-proof.js";
import { bindWorkingDnaTaskOutcomeRecord } from "../evolution-control/task-outcome-binding.js";
import { inspectTurnSensorsFromSkillInvocations } from "../evolution-control/turn-sensors.js";

export const EVOLUTION_TASK_OUTCOMES_FILENAME = "evolution-task-outcomes.jsonl";

export type EvolutionTaskOutcomeKind = "completed" | "failed" | "skipped";

export type EvolutionTaskOutcomeRecord = {
  agentId: string;
  occurredAt: number;
  succeeded: boolean;
  tenantId?: string;
  experimentId?: string;
  applicationId?: string;
  cohortRef?: string;
  runId?: string;
  taskId?: string;
  surfaceId?: string;
  outcome?: EvolutionTaskOutcomeKind | "unavailable" | "rejected";
  timestamp?: string;
  attribution?: {
    ownershipProof: string;
    source: string;
  };
  observationEligibility?: "eligible" | "unavailable" | "rejected";
  toolsObserved?: number;
  latencyMs?: number;
  securityViolation?: boolean;
  suspectedAuthorizationBypass?: boolean;
  crossTenantContamination?: boolean;
  humanTakeover?: boolean;
};

export function resolveEvolutionTaskOutcomesPath(cfg: OpenBotConfig, agentId: string): string {
  return path.join(resolveAgentDir(cfg, agentId), EVOLUTION_TASK_OUTCOMES_FILENAME);
}

export function appendEvolutionTaskOutcome(
  cfg: OpenBotConfig,
  record: EvolutionTaskOutcomeRecord,
  options?: { persistDir?: string; skillInvocationConfigDir?: string },
): EvolutionTaskOutcomeRecord {
  // Caller experiment/application IDs are not authoritative. Binding reads
  // Evolution Control persist state and strips forged or partial IDs.
  const bound = attachTurnSensors(
    bindWorkingDnaTaskOutcomeRecord(record, options?.persistDir),
    options?.skillInvocationConfigDir,
  );
  const sealed = sealEvolutionTaskOutcome(bound, options?.persistDir);
  const filePath = resolveEvolutionTaskOutcomesPath(cfg, sealed.agentId);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(sealed)}\n`, "utf8");
  } catch (error) {
    reportEvolutionOutcomeWriteFailure({
      runId: sealed.runId ?? null,
      agentId: sealed.agentId,
      tenantId: sealed.tenantId ?? null,
      taskId: sealed.taskId ?? null,
      reason: error instanceof Error ? error.message : "evolution_outcome_write_failed",
    });
    throw error;
  }
  logEvolutionLoop("evolution.outcome.written", {
    runId: sealed.runId ?? null,
    agentId: sealed.agentId,
    tenantId: sealed.tenantId ?? null,
    surfaceId: sealed.surfaceId ?? "task.execution",
    reason: sealed.observationEligibility ?? "written",
  });
  return sealed;
}

function sealEvolutionTaskOutcome(
  record: EvolutionTaskOutcomeRecord,
  persistDir?: string,
): EvolutionTaskOutcomeRecord {
  const runId = record.runId?.trim() || undefined;
  const tenantId = record.tenantId?.trim() || undefined;
  const executionOutcome: EvolutionTaskOutcomeKind =
    record.outcome === "skipped" ? "skipped" : record.succeeded ? "completed" : "failed";
  let observationEligibility: NonNullable<EvolutionTaskOutcomeRecord["observationEligibility"]> =
    "eligible";
  let outcome: EvolutionTaskOutcomeRecord["outcome"] = executionOutcome;
  if (!tenantId) {
    observationEligibility = "rejected";
    outcome = "rejected";
  } else if (!runId) {
    observationEligibility = "unavailable";
    outcome = "unavailable";
  }
  const issued =
    runId && tenantId
      ? issueRuntimeOwnershipProof({
          runId,
          agentId: record.agentId,
          tenantId,
          persistDir,
        })
      : null;
  return {
    ...record,
    ...(runId ? { runId } : {}),
    ...(tenantId ? { tenantId } : {}),
    taskId: record.taskId?.trim() || runId,
    surfaceId: record.surfaceId?.trim() || "task.execution",
    outcome,
    timestamp: record.timestamp ?? new Date(record.occurredAt).toISOString(),
    observationEligibility,
    attribution: record.attribution ?? {
      ownershipProof: issued?.fingerprint ?? "missing",
      source: issued ? "task-outcome" : "unattributed",
    },
  };
}

function attachTurnSensors(
  record: EvolutionTaskOutcomeRecord,
  skillInvocationConfigDir?: string,
): EvolutionTaskOutcomeRecord {
  if (
    typeof record.securityViolation === "boolean" &&
    (record.tenantId || typeof record.latencyMs !== "number")
  ) {
    return record;
  }
  if (typeof record.latencyMs !== "number" || !Number.isFinite(record.latencyMs)) {
    return record;
  }
  const sensors = inspectTurnSensorsFromSkillInvocations({
    agentId: record.agentId,
    startedAt: record.occurredAt - record.latencyMs,
    endedAt: record.occurredAt,
    ...(record.runId ? { runId: record.runId } : {}),
    ...(typeof record.toolsObserved === "number" ? { toolsObserved: record.toolsObserved } : {}),
    ...(skillInvocationConfigDir ? { configDir: skillInvocationConfigDir } : {}),
  });
  return {
    ...record,
    ...(record.securityViolation === undefined && typeof sensors.securityViolation === "boolean"
      ? { securityViolation: sensors.securityViolation }
      : {}),
    ...(record.suspectedAuthorizationBypass === undefined &&
    typeof sensors.suspectedAuthorizationBypass === "boolean"
      ? { suspectedAuthorizationBypass: sensors.suspectedAuthorizationBypass }
      : {}),
    ...(record.tenantId || sensors.tenantId
      ? { tenantId: record.tenantId ?? sensors.tenantId }
      : {}),
  };
}

export function readEvolutionTaskOutcomes(
  cfg: OpenBotConfig,
  agentId: string,
): EvolutionTaskOutcomeRecord[] {
  const filePath = resolveEvolutionTaskOutcomesPath(cfg, agentId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const rows: EvolutionTaskOutcomeRecord[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as EvolutionTaskOutcomeRecord;
      if (parsed.agentId !== agentId || typeof parsed.occurredAt !== "number") {
        continue;
      }
      rows.push(parsed);
    } catch {
      // skip corrupt lines
    }
  }
  return rows;
}
