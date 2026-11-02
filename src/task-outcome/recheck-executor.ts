/**
 * Original-scenario recheck. Off by default.
 * A closed switch does not append a version or an observation.
 * The scenario is the named correction snapshot's own contract and decisive run.
 * A caller-supplied id that does not match that snapshot fails closed.
 * run() receives that bound scenario. A bare { ok: true } is not a completed recheck.
 * Recheck success does not rewrite taskJudgement.
 */
import type { OpenBotConfig } from "../config/config.js";
import { recordRecheckObservation } from "./recheck-observation.js";
import { resolveConfiguredTaskOutcomeRoot } from "./reject-result.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TaskOutcomeRecord } from "./types.js";

export const RECHECK_EXECUTION_ENABLED = false;

export type RecheckScenario = {
  taskId: string;
  outcomeVersion: number;
  taskContractVersion: string;
  scenarioId: string;
};

export type RecheckRunResult =
  | ({ ok: true } & RecheckScenario)
  | { ok: false; reason: "timeout" | "tool_failure" | "failed" };

export type RecheckRun = (scenario: RecheckScenario) => RecheckRunResult;

export type RecheckExecutionResult =
  | { ok: true; status: "completed" | "incomplete"; outcomeVersion: number; attempt: number }
  | {
      ok: false;
      code:
        | "not_enabled"
        | "scenario_missing"
        | "binding_mismatch"
        | "not_a_correction"
        | "version_missing"
        | "storage_failed";
    };

/**
 * Scenario id is the decisive run stored on this version.
 * No other session, and no caller-invented id, can stand in for it.
 */
export function resolveStoredRecheckScenario(
  snap: Pick<
    TaskOutcomeRecord,
    "taskId" | "outcomeVersion" | "taskContractVersion" | "decisiveRunId" | "taskContract"
  >,
): RecheckScenario | null {
  const taskId = snap.taskId.trim();
  const taskContractVersion = snap.taskContractVersion.trim();
  const scenarioId = snap.decisiveRunId?.trim() ?? "";
  if (!taskId || !taskContractVersion || !scenarioId) {
    return null;
  }
  if (!Number.isInteger(snap.outcomeVersion) || snap.outcomeVersion < 1) {
    return null;
  }
  const contractVersion = snap.taskContract?.version.trim() ?? "";
  if (contractVersion && contractVersion !== taskContractVersion) {
    return null;
  }
  return {
    taskId,
    outcomeVersion: snap.outcomeVersion,
    taskContractVersion,
    scenarioId,
  };
}

function provesBoundScenario(result: RecheckRunResult, bound: RecheckScenario): boolean {
  if (!result.ok) {
    return false;
  }
  return (
    result.taskId === bound.taskId &&
    result.outcomeVersion === bound.outcomeVersion &&
    result.taskContractVersion === bound.taskContractVersion &&
    result.scenarioId === bound.scenarioId
  );
}

export async function executeOriginalScenarioRecheck(input: {
  cfg: OpenBotConfig;
  agentId: string;
  taskId: string;
  outcomeVersion: number;
  taskContractVersion?: string;
  scenarioId?: string;
  enabled?: boolean;
  run?: RecheckRun;
}): Promise<RecheckExecutionResult> {
  const enabled = input.enabled ?? RECHECK_EXECUTION_ENABLED;
  if (!enabled) {
    return { ok: false, code: "not_enabled" };
  }
  const taskContractVersion = input.taskContractVersion?.trim() ?? "";
  const scenarioId = input.scenarioId?.trim() ?? "";
  if (!taskContractVersion || !scenarioId) {
    return { ok: false, code: "scenario_missing" };
  }
  const located = resolveConfiguredTaskOutcomeRoot(input.cfg, input.agentId);
  if (!located.ok) {
    return { ok: false, code: "version_missing" };
  }
  const store = new DurableTaskOutcomeStore(located.root);
  try {
    const snap = store.loadTaskVersion(input.taskId, input.outcomeVersion);
    const tipBefore = store.loadTask(input.taskId);
    if (!snap || !tipBefore) {
      return { ok: false, code: "version_missing" };
    }
    if (snap.revisionKind !== "correction") {
      return { ok: false, code: "not_a_correction" };
    }
    const bound = resolveStoredRecheckScenario(snap);
    if (!bound) {
      return { ok: false, code: "scenario_missing" };
    }
    if (
      bound.taskId !== input.taskId ||
      bound.outcomeVersion !== input.outcomeVersion ||
      bound.taskContractVersion !== taskContractVersion ||
      bound.scenarioId !== scenarioId
    ) {
      return { ok: false, code: "binding_mismatch" };
    }
    const versionBefore = tipBefore.outcomeVersion;
    const judgementBefore = snap.taskJudgement;
    let runResult: RecheckRunResult;
    try {
      runResult = input.run ? input.run(bound) : { ok: false, reason: "failed" };
    } catch {
      runResult = { ok: false, reason: "failed" };
    }
    if (runResult.ok && !provesBoundScenario(runResult, bound)) {
      return { ok: false, code: "binding_mismatch" };
    }
    const status = runResult.ok ? "completed" : "incomplete";
    const recorded = await recordRecheckObservation({
      rootDir: located.root,
      taskId: input.taskId,
      outcomeVersion: input.outcomeVersion,
      status,
    });
    if (!recorded.ok) {
      return recorded;
    }
    const snapAfter = store.loadTaskVersion(input.taskId, input.outcomeVersion);
    const tipAfter = store.loadTask(input.taskId);
    if (
      !snapAfter ||
      snapAfter.taskJudgement !== judgementBefore ||
      !tipAfter ||
      tipAfter.outcomeVersion !== versionBefore ||
      tipAfter.taskJudgement !== tipBefore.taskJudgement
    ) {
      throw new Error("recheck execution changed the authoritative judgement");
    }
    return {
      ok: true,
      status,
      outcomeVersion: input.outcomeVersion,
      attempt: recorded.attempt,
    };
  } finally {
    store.close();
  }
}
