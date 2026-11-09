/**
 * R2 acceptance counterexamples. Isolation only: no gateway and no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTaskBudgetState } from "../task-outcome/budget.js";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import {
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
} from "../task-outcome/runtime-from-runner.js";
import { chargeRunnerTurnBudgetSpend } from "../task-outcome/runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { loadPersistedAssociations, publishFinalEvidenceLink } from "./association.js";
import { resetEvidenceAssociations } from "./association.js";
import { buildCostColumns } from "./cost-columns.js";
import { GOVERNED_MODEL_ENTRY } from "./governed-model-entry.js";
import {
  beginModelCall,
  finishModelCall,
  listModelCalls,
  noteModelResponse,
  observeModelCandidate,
  resetModelCallsForTests,
} from "./model-call-evidence.js";
import { readExecutorEvidence } from "./read-port.js";

const scope: TrustedScope = {
  kind: "enterprise",
  enterpriseDomainId: "enterprise:acme",
  tenantId: "tenant-a",
  subjectRef: "user:evidence",
  authzScopeRef: "authz:desk",
};
const rates = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
const roots: string[] = [];

function agentCfg(agentDir: string) {
  return {
    agents: { list: [{ id: "bot", agentDir, workspace: agentDir }] },
    models: { providers: { local: { models: [{ id: "fake", cost: rates }] } } },
  } as never;
}

function fullUsage(input: number, output: number) {
  return { input, output, cacheRead: 0, cacheWrite: 0 };
}

afterEach(() => {
  resetModelCallsForTests();
  resetEvidenceAssociations();
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("R2 final receipt uses the real call from the four entries", () => {
  it("links the charged call after acceptance, delivery, and modality updates", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r2-final-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const taskId = "task-r2-final";
    const runId = "run-r2-final";
    const link = await observeModelCandidate({
      context: {
        agentId: "bot",
        scope,
        taskId,
        runId,
        storeRoot: path.join(agentDir, "task-outcomes"),
        provenance: "injected",
        collector: "isolation",
      },
      attemptIndex: 0,
      provider: "local",
      model: "fake",
      run: async () => {
        const charged = chargeModelCallAgainstTip(cfg, "bot", {
          taskId,
          scope,
          runId,
          callSeq: 1,
          provider: "local",
          model: "fake",
          usage: fullUsage(1, 0),
          budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
        });
        return charged.modelCallLink;
      },
    });
    if (!link) {
      throw new Error("missing model call link");
    }
    expect(link.callId).toMatch(/^call_/);
    const closed = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId,
      taskId,
      scope,
      skipBudgetCharge: true,
      modelCallLink: link,
      acceptance: { status: "passed" },
      delivery: { status: "delivered" },
      deliveryId: "del-r2",
      capabilityOutcome: {
        planFailureKind: "none",
        allowedModality: "chat",
        forbiddenSuccessModalities: [],
        status: "routing_ok",
        textReturnedAllowed: true,
      },
    });
    const rows = loadPersistedAssociations(path.join(agentDir, "task-outcomes")).filter(
      (row) =>
        row.finalOutcomeVersion === closed.record.outcomeVersion && row.callId === link?.callId,
    );
    expect(rows.some((row) => row.completeness === "complete")).toBe(true);
    expect(rows[0]?.chargeOutcomeVersion).toBe(link.chargeOutcomeVersion);
    expect(rows[0]?.chargeOutcomeVersion).not.toBe(rows[0]?.finalOutcomeVersion);
    expect(rows[0]?.candidateAttemptId).not.toBe(rows[0]?.taskAttemptId);
    const missing = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-no-call",
      taskId: "task-no-call",
      scope,
      skipBudgetCharge: true,
      failureReason: "run_failed",
    });
    expect(
      loadPersistedAssociations(path.join(agentDir, "task-outcomes")).some(
        (row) => row.chain.taskId === "task-no-call" && row.completeness === "complete",
      ),
    ).toBe(false);
    expect(missing.record.taskId).toBe("task-no-call");
    for (const file of [
      "src/agent-runtime/execution/outcomes/turn-outcome.ts",
      "src/auto-reply/reply/followup-runner.ts",
      "src/agent-runtime/execution/outcomes/command-outcome.ts",
      "src/cron/isolated-agent/run.ts",
    ]) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).toContain("modelCallLink");
      expect(source).toContain("recordRunnerTurnOutcome");
    }
  });

  it("does not mark a mismatched call complete", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r2-mismatch-"));
    roots.push(storeRoot);
    const call = beginModelCall({
      context: {
        agentId: "other",
        scope,
        taskId: "other-task",
        runId: "other-run",
        storeRoot,
        provenance: "injected",
        collector: "isolation",
      },
      attemptId: "candidate",
      attemptKind: "fallback_candidate",
      provider: "local",
      model: "fake",
    });
    const linked = publishFinalEvidenceLink({
      storeRoot,
      call,
      scope,
      agentId: "bot",
      taskId: "task-real",
      runId: "run-real",
      candidateAttemptId: "candidate",
      taskAttemptId: "attempt-real",
      chargeOutcomeVersion: 3,
      finalOutcomeVersion: 6,
      recordRuns: [{ runId: "run-real", attemptIds: ["attempt-real"] }],
      recordAttempts: ["attempt-real"],
      receiptReturned: true,
      usageFingerprint: "not-the-call",
    });
    expect(linked?.completeness).not.toBe("complete");
    expect(linked?.finalOutcomeVersion).toBeNull();
  });
});

describe("R2 final link is bounded and not overwritten", () => {
  it("keeps the first association when the same identity is written again", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r2-lock-"));
    roots.push(storeRoot);
    const call = beginModelCall({
      context: {
        agentId: "bot",
        scope,
        taskId: "task-lock",
        runId: "run-lock",
        storeRoot,
        provenance: "injected",
        collector: "isolation",
      },
      attemptId: "candidate-lock",
      attemptKind: "fallback_candidate",
      provider: "local",
      model: "fake",
    });
    const first = publishFinalEvidenceLink({
      storeRoot,
      call,
      scope,
      agentId: "bot",
      taskId: "task-lock",
      runId: "run-lock",
      candidateAttemptId: call.attemptId,
      taskAttemptId: "attempt-lock",
      chargeOutcomeVersion: 3,
      finalOutcomeVersion: 6,
      recordRuns: [{ runId: "run-lock", attemptIds: ["attempt-lock"] }],
      recordAttempts: ["attempt-lock"],
      receiptReturned: true,
    });
    publishFinalEvidenceLink({
      storeRoot,
      call,
      scope,
      agentId: "bot",
      taskId: "task-lock",
      runId: "run-lock",
      candidateAttemptId: call.attemptId,
      taskAttemptId: "attempt-lock",
      chargeOutcomeVersion: 9,
      finalOutcomeVersion: 6,
      recordRuns: [{ runId: "run-lock", attemptIds: ["attempt-lock"] }],
      recordAttempts: ["attempt-lock"],
      receiptReturned: true,
    });
    const files = fs.readdirSync(path.join(storeRoot, "executor-evidence", "associations"));
    const finals = files.filter((name) => name.includes("final-"));
    expect(finals).toHaveLength(1);
    const saved = JSON.parse(
      fs.readFileSync(path.join(storeRoot, "executor-evidence", "associations", finals[0]), "utf8"),
    ) as { chargeOutcomeVersion: number };
    expect(saved.chargeOutcomeVersion).toBe(first?.chargeOutcomeVersion);
  });
});

describe("R2 usage, illegal numbers, and unattributable totals", () => {
  it("keeps observed usage when the candidate fails after the response", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    await expect(
      observeModelCandidate({
        context: {
          agentId: "bot",
          scope,
          taskId: "task-usage",
          runId: "run-usage",
          provenance: "injected",
          collector: "isolation",
        },
        attemptIndex: 0,
        provider: "local",
        model: "fake",
        run: async (identity) => {
          const call = listModelCalls().find((row) => row.callId === identity?.callId);
          noteModelResponse(call!, { usage: fullUsage(4, 5), usageSource: "charge_callback" });
          throw new Error("post-process");
        },
      }),
    ).rejects.toThrow("post-process");
    expect(listModelCalls()[0]?.status).toBe("failed");
    expect(listModelCalls()[0]?.usage).toEqual({
      input: 4,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("rejects illegal tokens on the direct cost path and completedAt after observedAt", () => {
    const priced = buildCostColumns({
      usage: { input: -3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      provider: "local",
      model: "fake",
      cost: rates,
      businessTaskId: "task-bad",
      runId: "run-bad",
    });
    expect(priced.estimatedUsd.status).not.toBe("known");
    expect(priced.estimatedUsd.amount).toBeNull();
    expect(priced.total.amount).toBeNull();
    const call = beginModelCall({
      context: {
        agentId: "bot",
        scope,
        taskId: "task-time",
        runId: "run-time",
        provenance: "injected",
        collector: "isolation",
      },
      attemptId: "time",
      attemptKind: "turn",
      provider: "local",
      model: "fake",
      nowMs: 100,
    });
    finishModelCall(call, {
      status: "completed",
      usage: fullUsage(1, 0),
      usageSource: "test",
      completedAt: 180,
      observedAt: 150,
    });
    expect(call.timeOrderValid).toBe(false);
    expect(call.status).not.toBe("completed");
  });

  it("does not expose a known total for a same-price usage conflict", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r2-total-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-total",
      scope,
      runId: "run-total",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(2, 0),
      budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
    });
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-total",
      scope,
      runId: "run-total",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(0, 2),
      budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
    });
    const row = loadPersistedAssociations(path.join(agentDir, "task-outcomes")).find(
      (item) => item.disposition === "conflict",
    );
    expect(row?.cost.total.status).not.toBe("known");
    expect(row?.cost.total.amount).toBeNull();
    expect(row?.cost.estimatedUsd.status).not.toBe("known");
    expect(row?.committedAttribution.amount).toBeNull();
  });
});

describe("R2 read port isolation and recovery boundaries", () => {
  it("withholds facts when the snapshot or command log is untrustworthy", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r2-read-"));
    roots.push(agentDir);
    const charged = chargeModelCallAgainstTip(agentCfg(agentDir), "bot", {
      taskId: "task-read-r2",
      scope,
      runId: "run-read-r2",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(1, 0),
      budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
    });
    const storeRoot = path.join(agentDir, "task-outcomes");
    const version = charged.budgetCommand.chargeOutcomeVersion ?? 1;
    const versionFile = path.join(storeRoot, "versions", `task-read-r2__v${version}.json`);
    const snapshot = JSON.parse(fs.readFileSync(versionFile, "utf8")) as { taskId: string };
    snapshot.taskId = "swapped";
    fs.writeFileSync(versionFile, `${JSON.stringify(snapshot)}\n`);
    const isolated = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-read-r2",
      outcomeVersion: version,
      storeRoot,
    });
    expect(isolated.receipts).toEqual([]);
    expect(isolated.associations).toEqual([]);
    expect(isolated.completeness).not.toBe("complete");
    expect(isolated.gaps.join(" ")).toMatch(/snapshot|identity/);
    fs.writeFileSync(path.join(storeRoot, "command-log", "broken.json"), "{");
    const corrupt = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-read-r2",
      storeRoot,
    });
    expect(corrupt.gaps).toContain("command_log_corrupt");
    expect(corrupt.completeness).not.toBe("complete");
  });

  it("does not parent-attribute a tampered stored spend, and still attributes a verified closed child", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r2-parent-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "parent-r2",
      scope,
      runId: "parent-run",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(0, 0),
      budgetLimits: { maxIterations: 8, maxCostUsd: 30, maxDurationMinutes: 30 },
    });
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const child = service.submit(
      "child-r2",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 1, maxCostUsd: 10, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-child-r2", requiredScope: scope },
    );
    if (!child.ok) {
      throw new Error("child");
    }
    const charged = service.submit(
      "child-r2",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: child.record.outcomeVersion,
        fencingToken: child.record.fencingToken ?? "",
      },
      { commandId: "budget-spend:child-r2:run-child:call:1", requiredScope: scope },
    );
    if (!charged.ok) {
      throw new Error("charge");
    }
    const closed = service.submit(
      "child-r2",
      {
        type: "fail_closed",
        reasonCode: "budget_exceeded",
        reasonDetail: "closed before parent",
        expectedVersion: charged.record.outcomeVersion,
        fencingToken: charged.record.fencingToken ?? "",
      },
      { commandId: "close-before-parent", requiredScope: scope },
    );
    expect(closed.ok).toBe(true);
    const logPath = store.commandLogPath("budget-spend:child-r2:run-child:call:1");
    const raw = JSON.parse(fs.readFileSync(logPath, "utf8")) as {
      committedSpend?: { costUsd: number };
    };
    raw.committedSpend = {
      ...(raw.committedSpend ?? { iterations: 1, costEvidence: "known" }),
      costUsd: 99,
    };
    fs.writeFileSync(logPath, `${JSON.stringify(raw)}\n`);
    store.close();
    chargeRunnerTurnBudgetSpend(cfg, "bot", {
      taskId: "child-r2",
      scope,
      runId: "run-child",
      callSeq: 1,
      costUsd: 9,
      costEvidence: "known",
      parentTaskId: "parent-r2",
    });
    const parent = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes")).loadTask(
      "parent-r2",
    );
    expect(parent?.budget?.childAttributedCostUsd ?? 0).not.toBe(99);
    expect(parent?.budget?.childAttributedCostUsd ?? 0).not.toBe(9);
  });
});

describe("R2 governed entry stays a wiring reference", () => {
  it("does not import the live model gate", () => {
    const source = fs.readFileSync("src/executor-evidence/governed-model-entry.ts", "utf8");
    expect(GOVERNED_MODEL_ENTRY.kind).toBe("wiring_reference_and_isolated_adapter");
    expect(source).not.toMatch(/from ["'][^"']*employee-model-gate/);
    expect(source).not.toMatch(/from ["'][^"']*model-fallback/);
  });
});
