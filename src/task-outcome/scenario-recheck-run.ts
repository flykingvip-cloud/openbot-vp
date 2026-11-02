/**
 * Replay the decisive run stored on the correction snapshot.
 * This reads that run. It does not execute tools and does not change taskJudgement.
 * A missing run, or a result that is only { ok: true }, is not a completed recheck.
 */
import type { OpenBotConfig } from "../config/config.js";
import {
  resolveStoredRecheckScenario,
  type RecheckRun,
  type RecheckRunResult,
  type RecheckScenario,
} from "./recheck-executor.js";
import { resolveConfiguredTaskOutcomeRoot } from "./reject-result.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TaskOutcomeRecord } from "./types.js";

export type StoredScenarioSnapshot = Pick<
  TaskOutcomeRecord,
  "taskId" | "outcomeVersion" | "taskContractVersion" | "decisiveRunId" | "taskContract" | "runs"
>;

export function replayStoredScenario(
  scenario: RecheckScenario,
  snap: StoredScenarioSnapshot | null,
): RecheckRunResult {
  if (!snap) {
    return { ok: false, reason: "failed" };
  }
  const bound = resolveStoredRecheckScenario(snap);
  if (
    !bound ||
    bound.taskId !== scenario.taskId ||
    bound.outcomeVersion !== scenario.outcomeVersion ||
    bound.taskContractVersion !== scenario.taskContractVersion ||
    bound.scenarioId !== scenario.scenarioId
  ) {
    return { ok: false, reason: "failed" };
  }
  const run = snap.runs.find((row) => row.runId === bound.scenarioId);
  if (!run || !run.fencingToken.trim() || !run.attemptIds.some((id) => id.trim())) {
    return { ok: false, reason: "failed" };
  }
  return {
    ok: true,
    taskId: bound.taskId,
    outcomeVersion: bound.outcomeVersion,
    taskContractVersion: bound.taskContractVersion,
    scenarioId: bound.scenarioId,
  };
}

function readScenarioSnapshot(
  cfg: OpenBotConfig,
  agentId: string,
  scenario: RecheckScenario,
): StoredScenarioSnapshot | null {
  const located = resolveConfiguredTaskOutcomeRoot(cfg, agentId);
  if (!located.ok) {
    return null;
  }
  const store = new DurableTaskOutcomeStore(located.root);
  try {
    return store.loadTaskVersion(scenario.taskId, scenario.outcomeVersion) ?? null;
  } catch {
    return null;
  } finally {
    store.close();
  }
}

export function createStoredScenarioRecheckRun(input: {
  cfg: OpenBotConfig;
  agentId: string;
  readSnapshot?: (scenario: RecheckScenario) => StoredScenarioSnapshot | null;
}): RecheckRun {
  const read =
    input.readSnapshot ??
    ((scenario: RecheckScenario) => readScenarioSnapshot(input.cfg, input.agentId, scenario));
  return (scenario) => replayStoredScenario(scenario, read(scenario));
}
