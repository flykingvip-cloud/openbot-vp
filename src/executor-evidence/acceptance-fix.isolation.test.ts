/**
 * Acceptance counterexamples for the upstream evidence fix.
 * Isolation only: temp files, injected transports, no gateway and no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTaskBudgetState } from "../task-outcome/budget.js";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import {
  chargeModelCallAgainstTip,
  chargeRunnerTurnBudgetSpend,
} from "../task-outcome/runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { loadPersistedAssociations, resetEvidenceAssociations } from "./association.js";
import { publishFinalEvidenceLink } from "./association.js";
import { buildCostColumns } from "./cost-columns.js";
import {
  GOVERNED_MODEL_ENTRY,
  ISOLATED_GOVERNED_DEFAULT_TIMEOUT_MS,
  runIsolatedGovernedModelCall,
} from "./governed-model-entry.js";
import {
  beginModelCall,
  executorEvidenceCollectionEnabled,
  finishModelCall,
  listModelCalls,
  noteModelResponse,
  observeModelCandidate,
  resetModelCallsForTests,
  usageFromUnknown,
  MODEL_CALL_MEMORY_CAP,
} from "./model-call-evidence.js";
import { readExecutorEvidence } from "./read-port.js";

const scope: TrustedScope = {
  kind: "enterprise",
  enterpriseDomainId: "enterprise:acme",
  tenantId: "tenant-a",
  subjectRef: "user:evidence",
  authzScopeRef: "authz:desk",
};
const otherTenant: TrustedScope = { ...scope, tenantId: "tenant-b" };
const otherAuthz: TrustedScope = { ...scope, authzScopeRef: "authz:other" };

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

describe("P1-1 memory read scope, run, and version", () => {
  it("rejects wrong scope, wrong run, cross-version, and cross-tenant memory reads", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-mem-"));
    roots.push(storeRoot);
    const context = {
      agentId: "bot",
      scope,
      taskId: "task-mem",
      runId: "run-a",
      storeRoot,
      provenance: "injected" as const,
      collector: "isolation",
    };
    const kept = beginModelCall({
      context,
      attemptId: "candidate-a",
      attemptKind: "fallback_candidate",
      provider: "local",
      model: "fake",
    });
    beginModelCall({
      context: { ...context, runId: "run-b" },
      attemptId: "candidate-b",
      attemptKind: "fallback_candidate",
      provider: "local",
      model: "fake",
    });
    beginModelCall({
      context: { ...context, scope: otherTenant },
      attemptId: "candidate-c",
      attemptKind: "fallback_candidate",
      provider: "local",
      model: "fake",
    });
    publishFinalEvidenceLink({
      storeRoot,
      call: kept,
      scope,
      agentId: "bot",
      taskId: "task-mem",
      runId: "run-a",
      candidateAttemptId: kept.attemptId,
      taskAttemptId: "attempt-task",
      chargeOutcomeVersion: 3,
      finalOutcomeVersion: 6,
      recordRuns: [{ runId: "run-a", attemptIds: ["attempt-task"] }],
      recordAttempts: ["attempt-task"],
      receiptReturned: true,
    });
    const exact = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-mem",
      runId: "run-a",
      outcomeVersion: 6,
      storeRoot,
      memoryOnly: true,
    });
    expect(exact.calls.map((call) => call.callId)).toEqual([kept.callId]);
    const wrongRun = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-mem",
      runId: "run-b",
      outcomeVersion: 6,
      storeRoot,
      memoryOnly: true,
    });
    expect(wrongRun.calls).toEqual([]);
    const wrongVersion = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-mem",
      runId: "run-a",
      outcomeVersion: 3,
      storeRoot,
      memoryOnly: true,
    });
    expect(wrongVersion.calls).toEqual([]);
    expect(wrongVersion.completeness).not.toBe("complete");
    for (const foreign of [otherTenant, otherAuthz]) {
      const denied = readExecutorEvidence({
        agentId: "bot",
        scope: foreign,
        taskId: "task-mem",
        runId: "run-a",
        outcomeVersion: 6,
        storeRoot,
        memoryOnly: true,
      });
      expect(denied.calls).toEqual([]);
      expect(denied.completeness).toBe("mismatch");
    }
  });
});

describe("P1-2 disk scope, snapshot identity, and gaps", () => {
  it("rejects a same-domain different tenant and a replaced snapshot", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-disk-"));
    roots.push(agentDir);
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const charged = chargeModelCallAgainstTip(agentCfg(agentDir), "bot", {
      taskId: "task-disk",
      scope,
      runId: "run-disk",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(1, 0),
      budgetLimits: { maxIterations: 4, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    const storeRoot = path.join(agentDir, "task-outcomes");
    const denied = readExecutorEvidence({
      agentId: "bot",
      scope: otherTenant,
      taskId: "task-disk",
      storeRoot,
    });
    expect(denied.completeness).toBe("mismatch");
    expect(denied.receipts).toEqual([]);
    const version = charged.budgetCommand.chargeOutcomeVersion;
    const versionFile = path.join(storeRoot, "versions", `task-disk__v${version}.json`);
    const snapshot = JSON.parse(fs.readFileSync(versionFile, "utf8")) as { taskJudgement: string };
    snapshot.taskJudgement = "success";
    fs.writeFileSync(versionFile, `${JSON.stringify(snapshot)}\n`);
    const tampered = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-disk",
      outcomeVersion: version ?? undefined,
      storeRoot,
    });
    expect(tampered.receipts).toEqual([]);
    expect(tampered.gaps.join(" ")).toMatch(/snapshot|identity|mismatch/);
    expect(tampered.completeness).not.toBe("complete");
  });

  it("downgrades when associations are empty or corrupt", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-gap-"));
    roots.push(storeRoot);
    fs.mkdirSync(path.join(storeRoot, "executor-evidence", "associations"), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, "executor-evidence", "associations", "broken.json"),
      "{not-json",
    );
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-empty",
      storeRoot,
    });
    expect(view.completeness).not.toBe("complete");
    expect(view.gaps.join(" ")).toMatch(/corrupt|read_failed|association/);
  });
});

describe("P1-3 final version is not the charge version", () => {
  it("keeps charge v3 unset as final until the v6 receipt is linked", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-final-"));
    roots.push(agentDir);
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const created = service.submit(
      "task-final",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-final", requiredScope: scope },
    );
    if (!created.ok) {
      throw new Error("create");
    }
    const token = created.record.fencingToken ?? "";
    const marked = service.submit(
      "task-final",
      {
        type: "record_attempt",
        attempt: {
          attemptId: "a-v2",
          runId: "run-final",
          status: "succeeded",
          observedAt: "2026-11-07T00:00:00.000Z",
        },
        run: {
          runId: "run-final",
          attemptIds: ["a-v2"],
          fencingToken: token,
          status: "succeeded",
        },
        expectedVersion: created.record.outcomeVersion,
        fencingToken: token,
      },
      { commandId: "bump-v2", requiredScope: scope },
    );
    if (!marked.ok) {
      throw new Error("bump");
    }
    expect(marked.record.outcomeVersion).toBe(2);
    store.close();
    const charged = chargeModelCallAgainstTip(agentCfg(agentDir), "bot", {
      taskId: "task-final",
      scope,
      runId: "run-final",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(1, 0),
    });
    expect(charged.budgetCommand.chargeOutcomeVersion).toBe(3);
    const midway = loadPersistedAssociations(path.join(agentDir, "task-outcomes")).find(
      (row) => row.budgetCommandId === charged.budgetCommand.commandId,
    );
    expect(midway?.finalOutcomeVersion ?? null).toBeNull();
    expect(midway?.completeness).not.toBe("complete");
    const reopened = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const again = new TaskOutcomeResultService({ store: reopened, submittedBy: "isolation" });
    let current = again.get("task-final");
    if (!current) {
      throw new Error("missing tip");
    }
    const steps = ["v4", "v5", "v6"] as const;
    let finalReceipt = charged.record;
    for (const step of steps) {
      const submitted = again.submit(
        "task-final",
        {
          type: "record_attempt",
          attempt: {
            attemptId: `a-${step}`,
            runId: "run-final",
            status: "succeeded",
            observedAt: "2026-11-07T00:00:00.000Z",
          },
          run: {
            runId: "run-final",
            attemptIds: [`a-${step}`],
            fencingToken: current.fencingToken ?? "",
            status: "succeeded",
          },
          expectedVersion: current.outcomeVersion,
          fencingToken: current.fencingToken ?? "",
        },
        { commandId: `closeout-${step}`, requiredScope: scope },
      );
      if (!submitted.ok) {
        throw new Error(step);
      }
      current = submitted.record;
      finalReceipt = submitted.record;
    }
    expect(finalReceipt.outcomeVersion).toBe(6);
    const linked = publishFinalEvidenceLink({
      storeRoot: path.join(agentDir, "task-outcomes"),
      scope,
      agentId: "bot",
      taskId: "task-final",
      runId: "run-final",
      candidateAttemptId: "run-final:correction",
      taskAttemptId: "attempt-real",
      chargeOutcomeVersion: 3,
      finalOutcomeVersion: finalReceipt.outcomeVersion,
      recordRuns: [{ runId: "run-final", attemptIds: ["attempt-real"] }],
      recordAttempts: ["attempt-real"],
      receiptReturned: true,
    });
    expect(linked?.chargeOutcomeVersion).toBe(3);
    expect(linked?.finalOutcomeVersion).toBe(6);
    expect(linked?.finalOutcomeVersion).not.toBe(linked?.chargeOutcomeVersion);
    reopened.close();
  });
});

describe("P1-4 candidate attempt is not a task attempt", () => {
  it("refuses complete for empty runs, the wrong run, or an arbitrary attempt id", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-attempt-"));
    roots.push(storeRoot);
    const call = beginModelCall({
      context: {
        agentId: "bot",
        scope,
        taskId: "task-attempt",
        runId: "run-real",
        storeRoot,
        provenance: "injected",
        collector: "isolation",
      },
      attemptId: "run-real:fallback:0:local/fake",
      attemptKind: "fallback_candidate",
      provider: "local",
      model: "fake",
    });
    const empty = publishFinalEvidenceLink({
      storeRoot,
      call,
      scope,
      agentId: "bot",
      taskId: "task-attempt",
      runId: "run-real",
      candidateAttemptId: call.attemptId,
      taskAttemptId: "attempt-real",
      chargeOutcomeVersion: 3,
      finalOutcomeVersion: 6,
      recordRuns: [],
      recordAttempts: [],
      receiptReturned: true,
    });
    expect(empty?.completeness).not.toBe("complete");
    const wrongRun = publishFinalEvidenceLink({
      storeRoot,
      call,
      scope,
      agentId: "bot",
      taskId: "task-attempt",
      runId: "run-other",
      candidateAttemptId: call.attemptId,
      taskAttemptId: "attempt-real",
      chargeOutcomeVersion: 3,
      finalOutcomeVersion: 6,
      recordRuns: [{ runId: "run-real", attemptIds: ["attempt-real"] }],
      recordAttempts: ["attempt-real"],
      receiptReturned: true,
    });
    expect(wrongRun?.completeness).not.toBe("complete");
    const arbitrary = publishFinalEvidenceLink({
      storeRoot,
      call,
      scope,
      agentId: "bot",
      taskId: "task-attempt",
      runId: "run-real",
      candidateAttemptId: call.attemptId,
      taskAttemptId: "not-on-the-record",
      chargeOutcomeVersion: 3,
      finalOutcomeVersion: 7,
      recordRuns: [{ runId: "run-real", attemptIds: ["attempt-real"] }],
      recordAttempts: ["attempt-real"],
      receiptReturned: true,
    });
    expect(arbitrary?.completeness).not.toBe("complete");
    expect(arbitrary?.candidateAttemptId).not.toBe(arbitrary?.taskAttemptId);
  });
});

describe("P1-5 restart resumes parent attribution and close from the committed spend", () => {
  it("attributes the original spend after a crash before parent attribution", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-parent-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "parent-task",
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
      "child-task",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 1, maxCostUsd: 10, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-child", requiredScope: scope },
    );
    if (!child.ok) {
      throw new Error("child");
    }
    const charged = service.submit(
      "child-task",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: child.record.outcomeVersion,
        fencingToken: child.record.fencingToken ?? "",
      },
      { commandId: "budget-spend:child-task:run-child:call:1", requiredScope: scope },
    );
    expect(charged.ok).toBe(true);
    store.close();
    const recovered = chargeRunnerTurnBudgetSpend(cfg, "bot", {
      taskId: "child-task",
      scope,
      runId: "run-child",
      callSeq: 1,
      costUsd: 9,
      costEvidence: "known",
      parentTaskId: "parent-task",
      parentAgentId: "bot",
    });
    expect(recovered.budgetCommand.committedCostUsd).not.toBe(9);
    expect(recovered.record.budget?.spentCostUsd).toBe(1);
    expect(recovered.closedForBudget).toBe(true);
    const parent = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes")).loadTask(
      "parent-task",
    );
    expect(parent?.budget?.childAttributedCostUsd).toBe(1);
  });

  it("closes an exhausted charge after a crash before fail_closed without billing the new callback", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-close-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const child = service.submit(
      "child-close",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 1, maxCostUsd: 10, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-close", requiredScope: scope },
    );
    if (!child.ok) {
      throw new Error("child");
    }
    const charged = service.submit(
      "child-close",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: child.record.outcomeVersion,
        fencingToken: child.record.fencingToken ?? "",
      },
      { commandId: "budget-spend:child-close:run-close:call:1", requiredScope: scope },
    );
    expect(charged.ok).toBe(true);
    if (!charged.ok) {
      return;
    }
    expect(charged.record.lifecycle).not.toBe("closed");
    store.close();
    const recovered = chargeRunnerTurnBudgetSpend(cfg, "bot", {
      taskId: "child-close",
      scope,
      runId: "run-close",
      callSeq: 1,
      costUsd: 8,
      costEvidence: "known",
    });
    expect(recovered.closedForBudget).toBe(true);
    expect(recovered.record.lifecycle).toBe("closed");
    expect(recovered.record.budget?.spentCostUsd).toBe(1);
    expect(recovered.budgetCommand.committedCostUsd).not.toBe(8);
    expect(recovered.budgetCommand.chargeOutcomeVersion).not.toBe(recovered.record.outcomeVersion);
  });
});

describe("P1-6 collection is opt-in and bounded", () => {
  it("collects nothing by default and caps memory", () => {
    expect(executorEvidenceCollectionEnabled()).toBe(false);
    const quiet = beginModelCall({
      context: {
        agentId: "bot",
        scope,
        taskId: "task-off",
        runId: "run-off",
        storeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-offmem-")),
        provenance: "injected",
        collector: "isolation",
      },
      attemptId: "off",
      attemptKind: "turn",
      provider: "local",
      model: "fake",
    });
    roots.push(quiet.storeRoot ?? "");
    expect(listModelCalls()).toEqual([]);
    expect(fs.existsSync(path.join(quiet.storeRoot ?? "", "executor-evidence"))).toBe(false);
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    for (let i = 0; i < MODEL_CALL_MEMORY_CAP + 25; i += 1) {
      beginModelCall({
        context: {
          agentId: "bot",
          scope,
          taskId: "task-cap",
          runId: "run-cap",
          provenance: "injected",
          collector: "isolation",
        },
        attemptId: `cap-${i}`,
        attemptKind: "turn",
        provider: "local",
        model: "fake",
      });
    }
    expect(listModelCalls().length).toBeLessThanOrEqual(MODEL_CALL_MEMORY_CAP);
  });
});

describe("P1-7 conflict does not commit the callback cost", () => {
  it("keeps a same-price different-usage conflict off the committed total", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-cost-"));
    roots.push(agentDir);
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const cfg = agentCfg(agentDir);
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-cost",
      scope,
      runId: "run-cost",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(2, 0),
      budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
    });
    const conflict = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-cost",
      scope,
      runId: "run-cost",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(0, 2),
      budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
    });
    expect(conflict.budgetCommand.disposition).toBe("conflict");
    expect(conflict.costUsd).toBeUndefined();
    const row = loadPersistedAssociations(path.join(agentDir, "task-outcomes")).find(
      (item) => item.disposition === "conflict",
    );
    expect(row?.committedAttribution.status).toBe("not_committed");
    expect(row?.committedAttribution.amount).toBeNull();
    expect(row?.callEstimate?.estimatedUsd.amount).toBe(2);
    expect(row?.callEstimate?.estimatedUsd.status).toBe("known");
  });
});

describe("P1-8 model response is not the candidate terminal state", () => {
  it("records failure when the candidate throws after a charge notes usage", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-terminal-"));
    roots.push(storeRoot);
    await expect(
      observeModelCandidate({
        context: {
          agentId: "bot",
          scope,
          taskId: "task-terminal",
          runId: "run-terminal",
          storeRoot,
          provenance: "injected",
          collector: "isolation",
        },
        attemptIndex: 0,
        provider: "local",
        model: "fake",
        run: async (identity) => {
          const call = listModelCalls().find((row) => row.callId === identity?.callId);
          if (!call) {
            throw new Error("missing call");
          }
          noteModelResponse(call, { usage: fullUsage(1, 1), usageSource: "charge_callback" });
          throw new Error("after charge");
        },
      }),
    ).rejects.toThrow("after charge");
    const call = listModelCalls()[0];
    expect(call?.modelResponseStatus).toBe("observed");
    expect(call?.status).not.toBe("completed");
    expect(call?.status).toBe("failed");
  });

  it("does not leave a budget-exceeded or failed fallback candidate completed", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-fallback-"));
    roots.push(storeRoot);
    const context = {
      agentId: "bot",
      scope,
      taskId: "task-fb",
      runId: "run-fb",
      storeRoot,
      provenance: "injected" as const,
      collector: "isolation",
    };
    await expect(
      observeModelCandidate({
        context,
        attemptIndex: 0,
        provider: "local",
        model: "fake",
        classifyError: () => "error",
        run: async (identity) => {
          const call = listModelCalls().find((row) => row.callId === identity?.callId);
          noteModelResponse(call!, { usage: fullUsage(1, 0), usageSource: "charge_callback" });
          throw Object.assign(new Error("budget"), { name: "TaskBudgetExceededError" });
        },
      }),
    ).rejects.toThrow("budget");
    await observeModelCandidate({
      context,
      attemptIndex: 1,
      provider: "other",
      model: "fake",
      run: async () => ({ meta: { agentMeta: { usage: fullUsage(1, 1) } } }),
    });
    const rows = listModelCalls();
    const failed = rows.find((row) => row.attemptId.includes(":fallback:0:"));
    const next = rows.find((row) => row.attemptId.includes(":fallback:1:"));
    expect(failed?.status).not.toBe("completed");
    expect(next?.status).toBe("completed");
  });
});

describe("replay identity, numeric bounds, and governed adapter claim", () => {
  it("refuses replay when the snapshot body no longer matches the commit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-replay-"));
    roots.push(root);
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const applied = service.submit(
      "task-replay-id",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "1" },
      { commandId: "cmd-replay-id", requiredScope: scope },
    );
    if (!applied.ok || !applied.commandReceipt?.commitId) {
      throw new Error("applied");
    }
    const versionFile = store.versionPath("task-replay-id", 1);
    const snapshot = JSON.parse(fs.readFileSync(versionFile, "utf8")) as { taskId: string };
    snapshot.taskId = "other-task";
    fs.writeFileSync(versionFile, `${JSON.stringify(snapshot)}\n`);
    const replay = service.submit(
      "task-replay-id",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "1" },
      { commandId: "cmd-replay-id", requiredScope: scope },
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.commandReceipt).toBeUndefined();
      expect(replay.evidenceGap?.reason).toMatch(/mismatch|identity/);
    }
    store.close();
  });

  it("rejects negative tokens, fractional tokens, and negative prices", () => {
    expect(usageFromUnknown({ input: -1, output: 1.5, cacheRead: 0, cacheWrite: 0 })).toEqual({
      input: null,
      output: null,
      cacheRead: 0,
      cacheWrite: 0,
    });
    const priced = buildCostColumns({
      usage: fullUsage(1, 0),
      provider: "local",
      model: "fake",
      cost: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0 },
      businessTaskId: "task-num",
      runId: "run-num",
    });
    expect(priced.estimatedUsd.status).not.toBe("known");
    expect(priced.estimatedUsd.amount).toBeNull();
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
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    finishModelCall(call, {
      status: "completed",
      usage: fullUsage(1, 0),
      usageSource: "test",
      completedAt: 50,
      observedAt: 40,
    });
    expect(call.status).not.toBe("completed");
    expect(call.timeOrderValid).toBe(false);
  });

  it("describes governed entry as a wiring reference and bounds the default timeout", async () => {
    expect(GOVERNED_MODEL_ENTRY.kind).toBe("wiring_reference_and_isolated_adapter");
    expect(ISOLATED_GOVERNED_DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ISOLATED_GOVERNED_DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(1_000);
    const started = Date.now();
    const result = await runIsolatedGovernedModelCall({
      purpose: "diagnosis",
      modelRef: "local/fake",
      resolutionSource:
        "src/gateway/model-entitlement/employee-model-gate.ts#resolveEmployeeModelGate",
      configVersion: "cfg-1",
      agentId: "bot",
      scope,
      taskId: "task-gov",
      runId: "run-gov",
      admission: () => ({ allowed: true, configVersion: "cfg-1" }),
      transport: () => new Promise(() => {}),
    });
    expect(Date.now() - started).toBeLessThan(ISOLATED_GOVERNED_DEFAULT_TIMEOUT_MS + 1_500);
    expect(result.fallback).toBe("rule_v1");
    expect(result.hypothesis?.source).not.toBe("model");
    expect(result.hypothesis?.text ?? "").not.toMatch(/^candidate /);
    expect(result.applied).toBe(false);
  });
});
