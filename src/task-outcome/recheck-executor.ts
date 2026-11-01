/**
 * Original-scenario recheck. Off by default.
 * A closed switch does not append a version or an observation.
 * A missing scenario id fails closed and does not look up another session.
 * A run only hangs an observation on the named correction version.
 */
import type { OpenBotConfig } from "../config/config.js";
import { recordRecheckObservation } from "./recheck-observation.js";
import { resolveConfiguredTaskOutcomeRoot } from "./reject-result.js";
import { DurableTaskOutcomeStore } from "./store.js";

export const RECHECK_EXECUTION_ENABLED = false;

export type RecheckRunResult =
  | { ok: true }
  | { ok: false; reason: "timeout" | "tool_failure" | "failed" };

export type RecheckExecutionResult =
  | { ok: true; status: "completed" | "incomplete"; outcomeVersion: number }
  | {
      ok: false;
      code: "not_enabled" | "scenario_missing" | "not_a_correction" | "version_missing";
    };

export function executeOriginalScenarioRecheck(input: {
  cfg: OpenBotConfig;
  agentId: string;
  taskId: string;
  outcomeVersion: number;
  taskContractVersion?: string;
  scenarioId?: string;
  enabled?: boolean;
  run?: () => RecheckRunResult;
}): RecheckExecutionResult {
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
    const versionBefore = tipBefore.outcomeVersion;
    const judgementBefore = snap.taskJudgement;
    let runResult: RecheckRunResult;
    try {
      runResult = input.run ? input.run() : { ok: false, reason: "failed" };
    } catch {
      runResult = { ok: false, reason: "failed" };
    }
    const status = runResult.ok ? "completed" : "incomplete";
    const recorded = recordRecheckObservation({
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
    return { ok: true, status, outcomeVersion: input.outcomeVersion };
  } finally {
    store.close();
  }
}
