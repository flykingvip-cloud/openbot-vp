import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { loadPersistedAssociations } from "../executor-evidence/association.js";
import {
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
  TASK_OUTCOME_STORE_DIRNAME,
} from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
it("preserves budget-closed authority and persists final membership gap", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-closeout-"));
  const cfg = { agents: { list: [{ id: "bot", agentDir }] } };
  const scope = {
    kind: "personal" as const,
    personalDomainId: "personal:test",
    subjectRef: "user:test",
    authzScopeRef: "scope:test",
  };
  const flag = process.env.OPENBOT_EXECUTOR_EVIDENCE;
  process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
  try {
    const charged = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task",
      scope,
      runId: "run",
      callSeq: 1,
      provider: "test",
      model: "test",
      usage: { input: 1, output: 1 },
      budgetLimits: { maxIterations: 1, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    expect(charged.record.lifecycle).toBe("closed");
    const root = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    const store = new DurableTaskOutcomeStore(root);
    const before = store.loadTask("task");
    const result = await recordRunnerTurnOutcome(cfg, "bot", {
      taskId: "task",
      scope,
      runId: "run",
      success: false,
      skipBudgetCharge: true,
    });
    expect(result.record).toEqual(before);
    expect(store.loadTask("task")).toEqual(before);
    expect(result.record.attempts).toEqual([]);
    expect(
      loadPersistedAssociations(root).some(
        (row) =>
          row.completeness === "partial" &&
          row.budgetChargeReasons?.includes("final_membership_missing") &&
          row.budgetChargeReasons.includes("terminal_protected"),
      ),
    ).toBe(true);
  } finally {
    if (flag === undefined) {
      delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
    } else {
      process.env.OPENBOT_EXECUTOR_EVIDENCE = flag;
    }
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

it("preserves existing failed membership on a late success", async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "member-closeout-"));
  const cfg = { agents: { list: [{ id: "bot", agentDir }] } };
  const scope = {
    kind: "personal" as const,
    personalDomainId: "personal:test",
    subjectRef: "user:test",
    authzScopeRef: "scope:test",
  };
  const flag = process.env.OPENBOT_EXECUTOR_EVIDENCE;
  process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
  try {
    const first = await recordRunnerTurnOutcome(cfg, "bot", {
      taskId: "task",
      scope,
      runId: "run",
      success: false,
      failureReason: "user_cancelled",
    });
    expect(first.record.lifecycle).toBe("closed");
    expect(first.record.attempts.some((a) => a.attemptId === "att:run")).toBe(true);
    const late = await recordRunnerTurnOutcome(cfg, "bot", {
      taskId: "task",
      scope,
      runId: "run",
      success: true,
    });
    expect(late.record).toEqual(first.record);
    expect(late.record.taskJudgement).not.toBe("success");
    expect(
      new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME)).loadTask("task"),
    ).toEqual(first.record);
  } finally {
    if (flag === undefined) {
      delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
    } else {
      process.env.OPENBOT_EXECUTOR_EVIDENCE = flag;
    }
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});
