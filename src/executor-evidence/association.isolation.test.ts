/**
 * Isolation-only association and cost-column proofs.
 * Uses the real budget charge path and temp files. No gateway and no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import { chargeModelCallAgainstTip } from "../task-outcome/runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import { associateBudgetCharge, loadPersistedAssociations } from "./association.js";
import { buildCostColumns, familyRollup } from "./cost-columns.js";
import {
  beginModelCall,
  resetModelCallsForTests,
  usageFromUnknown,
} from "./model-call-evidence.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:evidence",
  subjectRef: "user:evidence",
  authzScopeRef: "scope:isolation",
};
const otherScope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:other",
  subjectRef: "user:other",
  authzScopeRef: "scope:isolation",
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

beforeEach(() => {
  process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
});

afterEach(() => {
  resetModelCallsForTests();
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cost columns", () => {
  it("keeps partial tokens, unknown prices, and real zero prices apart", () => {
    const partial = buildCostColumns({
      usage: { input: 5, output: null, cacheRead: null, cacheWrite: null },
      provider: "local",
      model: "fake",
      cost: rates,
      businessTaskId: "task-cost",
      runId: "run-cost",
    });
    expect(partial.tokens.completeness).toBe("partial");
    expect(partial.estimatedUsd).toMatchObject({ amount: null, status: "partial" });
    expect(partial.total.status).not.toBe("known");

    const unpriced = buildCostColumns({
      usage: fullUsage(4, 4),
      provider: "local",
      model: "fake",
      cost: null,
      businessTaskId: "task-cost",
      runId: "run-cost",
    });
    expect(unpriced.estimatedUsd).toMatchObject({
      amount: null,
      status: "unknown",
      basis: "unknown",
    });
    expect(unpriced.providerProcurementCost.status).toBe("unknown");
    expect(unpriced.credits.status).toBe("unknown");

    const zero = buildCostColumns({
      usage: fullUsage(0, 0),
      provider: "local",
      model: "fake",
      cost: rates,
      businessTaskId: "task-cost",
      runId: "run-cost",
    });
    expect(zero.estimatedUsd).toMatchObject({
      amount: 0,
      status: "known",
      basis: "config_estimate",
    });
    expect(zero.estimatedUsd.pricingFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(zero.billingCorrelation).toEqual({ businessTaskId: "task-cost", runId: "run-cost" });
  });

  it("does not add child amounts that are already on the parent rollup", () => {
    const safe = familyRollup({
      parentOwnUsd: 1,
      parentChildAttributedUsd: null,
      childOwnUsd: [2],
    });
    expect(safe).toEqual({ amount: 3, status: "known", doubleCountRisk: false });
    const unsafe = familyRollup({ parentOwnUsd: 1, parentChildAttributedUsd: 2, childOwnUsd: [2] });
    expect(unsafe).toEqual({ amount: null, status: "unknown", doubleCountRisk: true });
  });

  it("distinguishes the same USD produced by different token mixes", () => {
    const left = buildCostColumns({
      usage: fullUsage(2, 0),
      provider: "local",
      model: "fake",
      cost: rates,
      businessTaskId: "task-mix",
      runId: "run-a",
    });
    const right = buildCostColumns({
      usage: fullUsage(0, 2),
      provider: "local",
      model: "fake",
      cost: rates,
      businessTaskId: "task-mix",
      runId: "run-b",
    });
    expect(left.estimatedUsd.amount).toBe(right.estimatedUsd.amount);
    expect(left.tokens).not.toEqual(right.tokens);
  });
});

describe("budget command association", () => {
  it("charges and closes on different versions, then replay does not bill again", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-assoc-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const first = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-bill",
      scope,
      runId: "run-bill",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(1, 0),
      budgetLimits: { maxIterations: 1, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    expect(first.budgetCommand.disposition).toBe("applied");
    expect(first.budgetCommand.closeOutcomeVersion).toBeGreaterThan(
      first.budgetCommand.chargeOutcomeVersion ?? 0,
    );
    expect(first.costUsd).toBeGreaterThan(0);
    const replay = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-replay",
      scope,
      runId: "run-replay",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(1, 0),
      budgetLimits: { maxIterations: 4, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    const spent = replay.record.budget?.spentCostUsd;
    const again = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-replay",
      scope,
      runId: "run-replay",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(1, 0),
      budgetLimits: { maxIterations: 4, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    // The wrapper reloads the tip, so expectedVersion is part of a new digest.
    // Same callSeq is then a conflict: the first commit wins and this cost is not billed.
    expect(again.budgetCommand.disposition).toBe("conflict");
    expect(again.costUsd).toBeUndefined();
    expect(again.budgetCommand.committedCostUsd).toBeNull();
    expect(again.record.budget?.spentCostUsd).toBe(spent);
    expect(again.budgetCommand.chargeOutcomeVersion).toBe(
      replay.budgetCommand.chargeOutcomeVersion,
    );
  });

  it("does not treat a conflicting callback cost as the committed charge", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-conflict-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const first = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-conflict",
      scope,
      runId: "run-conflict",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(1, 0),
    });
    const second = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-conflict",
      scope,
      runId: "run-conflict",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(9, 0),
    });
    expect(second.budgetCommand.disposition).toBe("conflict");
    expect(second.costUsd).toBeUndefined();
    expect(second.budgetCommand.committedCostUsd).toBeNull();
    expect(second.record.budget?.spentCostUsd).toBe(first.record.budget?.spentCostUsd);
  });

  it("keeps same-price calls distinct and does not inherit a correction", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-mix-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const limits = { maxIterations: 5, maxCostUsd: 100, maxDurationMinutes: 30 };
    const left = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-mix",
      scope,
      runId: "run-mix",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(2, 0),
    });
    const right = chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-mix",
      scope,
      runId: "run-mix",
      callSeq: 2,
      provider: "local",
      model: "fake",
      usage: fullUsage(0, 2),
    });
    expect(left.costUsd).toBe(right.costUsd);
    const storeRoot = path.join(agentDir, "task-outcomes");
    const rows = loadPersistedAssociations(storeRoot);
    expect(new Set(rows.map((row) => row.usageFingerprint)).size).toBe(2);
    const correction = {
      ...right.record,
      outcomeVersion: right.record.outcomeVersion + 1,
      revisionKind: "correction",
      taskJudgement: right.record.taskJudgement,
    } satisfies TaskOutcomeRecord;
    const linked = associateBudgetCharge({
      storeRoot,
      call: beginModelCall({
        context: {
          agentId: "bot",
          scope,
          taskId: "task-mix",
          runId: "run-mix",
          storeRoot,
          provenance: "injected",
          collector: "isolation",
        },
        attemptId: "run-mix:correction",
        attemptKind: "turn",
        provider: "local",
        model: "fake",
      }),
      budget: {
        commandId: "correction-budget",
        requestDigest: "digest",
        disposition: "applied",
        commitId: "c_correction",
        chargeOutcomeVersion: correction.outcomeVersion,
        closeOutcomeVersion: null,
        committedCostUsd: null,
        costStatus: "unknown",
      },
      record: correction,
      scope,
      agentId: "bot",
      taskId: "task-mix",
      runId: "run-mix",
      usage: usageFromUnknown(fullUsage(1, 1)),
      cost: buildCostColumns({
        usage: usageFromUnknown(fullUsage(1, 1)),
        businessTaskId: "task-mix",
        runId: "run-mix",
      }),
    });
    expect(linked?.correctionInherited).toBe(false);
    expect(linked?.finalOutcomeVersion).toBeNull();
    expect(
      loadPersistedAssociations(storeRoot).some(
        (row) => row.finalOutcomeVersion === correction.outcomeVersion,
      ),
    ).toBe(false);
    const versionOne = loadPersistedAssociations(storeRoot).filter(
      (row) => row.finalOutcomeVersion === left.budgetCommand.chargeOutcomeVersion,
    );
    expect(versionOne.every((row) => row.finalOutcomeVersion !== correction.outcomeVersion)).toBe(
      true,
    );
    expect(limits.maxIterations).toBeGreaterThan(1);
  });

  it("reports enqueue_only, a missing tip, and a scope mismatch without rewriting judgement", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-chain-"));
    roots.push(storeRoot);
    const record = {
      taskId: "task-chain",
      outcomeVersion: 3,
      taskJudgement: "incomplete",
      delivery: { status: "pending" },
      deliveryId: "should-not-count",
    } as TaskOutcomeRecord;
    const queued = associateBudgetCharge({
      storeRoot,
      call: null,
      budget: {
        commandId: "cmd",
        requestDigest: "d",
        disposition: "applied",
        commitId: "c_1",
        chargeOutcomeVersion: 3,
        closeOutcomeVersion: null,
        committedCostUsd: null,
        costStatus: "unknown",
      },
      record,
      scope,
      agentId: "bot",
      taskId: "task-chain",
      runId: "run-chain",
      usage: usageFromUnknown({}),
      cost: buildCostColumns({
        usage: usageFromUnknown({}),
        businessTaskId: "task-chain",
        runId: "run-chain",
      }),
      deliveryAttempts: [{ source: "enqueue_only" }],
    });
    expect(queued?.deliveryTruth).toBe("enqueue_only");
    expect(queued?.deliveryId).toBeNull();
    expect(queued?.taskJudgement).toBe("incomplete");
    expect(queued?.completeness).toBe("partial");
    const noTip = associateBudgetCharge({
      storeRoot,
      call: null,
      budget: {
        commandId: "cmd-missing",
        requestDigest: null,
        disposition: "absent",
        commitId: null,
        chargeOutcomeVersion: null,
        closeOutcomeVersion: null,
        committedCostUsd: null,
        costStatus: "not_committed",
      },
      scope,
      agentId: "bot",
      taskId: "task-missing",
      runId: "run-missing",
      usage: usageFromUnknown({}),
      cost: buildCostColumns({
        usage: usageFromUnknown({}),
        businessTaskId: "task-missing",
        runId: "run-missing",
      }),
    });
    expect(noTip?.missing).toContain("tip");
    expect(noTip?.chain.source).toBe("absent");
    const foreign = beginModelCall({
      context: {
        agentId: "other-bot",
        scope: otherScope,
        taskId: "task-chain",
        runId: "run-chain",
        provenance: "injected",
        collector: "isolation",
      },
      attemptId: "other",
      attemptKind: "turn",
      provider: "local",
      model: "fake",
    });
    expect(
      associateBudgetCharge({
        storeRoot,
        call: foreign,
        budget: queued!.budgetCommandId
          ? {
              commandId: "cmd",
              requestDigest: "d",
              disposition: "applied",
              commitId: "c_1",
              chargeOutcomeVersion: 3,
              closeOutcomeVersion: null,
              committedCostUsd: null,
              costStatus: "unknown",
            }
          : {
              commandId: "cmd",
              requestDigest: "d",
              disposition: "applied",
              commitId: "c_1",
              chargeOutcomeVersion: 3,
              closeOutcomeVersion: null,
              committedCostUsd: null,
              costStatus: "unknown",
            },
        record,
        scope,
        agentId: "bot",
        taskId: "task-chain",
        runId: "run-chain",
        usage: usageFromUnknown({}),
        cost: buildCostColumns({
          usage: usageFromUnknown({}),
          businessTaskId: "task-chain",
          runId: "run-chain",
        }),
      }),
    ).toBeNull();
  });

  it("still commits the budget when evidence collection is disabled", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "0";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-off-"));
    roots.push(agentDir);
    const charged = chargeModelCallAgainstTip(agentCfg(agentDir), "bot", {
      taskId: "task-off",
      scope,
      runId: "run-off",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: fullUsage(1, 0),
    });
    expect(charged.budgetCommand.disposition).toBe("applied");
    expect(charged.record.budget?.iterationCount).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(agentDir, "task-outcomes", "executor-evidence"))).toBe(false);
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store });
    expect(service.get("task-off")?.taskJudgement).toBe(charged.record.taskJudgement);
    store.close();
  });
});
