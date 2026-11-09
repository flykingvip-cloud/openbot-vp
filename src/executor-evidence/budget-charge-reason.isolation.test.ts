/**
 * Uncertain command-charge reasons must survive a process restart.
 * Memory is cleared after the write. The read comes from the association files.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordRunnerTurnOutcome } from "../task-outcome/runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { readAssociationFiles, resetEvidenceAssociations } from "./association.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:evidence",
  subjectRef: "user:evidence",
  authzScopeRef: "scope:isolation",
};
const roots: string[] = [];

afterEach(() => {
  resetEvidenceAssociations();
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("uncertain command charge reasons stay on the association file", () => {
  it("reads the reason from disk after the in-memory association list is cleared", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-charge-reason-"));
    roots.push(agentDir);
    const cfg = {
      agents: { list: [{ id: "bot", agentDir, workspace: agentDir }] },
    };
    const reasons = ["1:conflict:conflict", "2:attempted_unknown:charge_not_returned"];
    await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-gap",
      taskId: "task-gap",
      scope,
      entrypoint: "cli",
      skipBudgetCharge: true,
      costUsd: 9,
      failureReason: "run_failed",
      failureDetail: "candidate charge did not commit",
      budgetChargeReasons: reasons,
    });
    resetEvidenceAssociations();
    const storeRoot = path.join(agentDir, "task-outcomes");
    const persisted = readAssociationFiles(storeRoot).rows.flatMap(
      (row) => row.budgetChargeReasons ?? [],
    );
    expect(persisted).toEqual(expect.arrayContaining(reasons));
    const reopened = new DurableTaskOutcomeStore(storeRoot);
    const task = reopened.loadTask("task-gap");
    expect(task?.budget?.spentCostUsd ?? 0).not.toBe(9);
    reopened.close();
  });
});
