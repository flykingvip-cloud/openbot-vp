/**
 * W3: 任务类型验收 + 任务级总预算（可证测试）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accumulateTaskBudgetSpend,
  applySpendAndAssess,
  assessTaskBudgetExhaustion,
  buildTaskBudgetState,
  resolveEffectiveTaskBudget,
} from "./budget.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import {
  assessAcceptanceByTaskType,
  buildTaskContractIdentity,
  isInventedNotRequiredSuccess,
} from "./task-type-acceptance.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:w3",
  subjectRef: "u",
  authzScopeRef: "s",
};

describe("W3 task-type acceptance", () => {
  it("A1: chat_turn + empty validators → not_required with reason", () => {
    const contract = buildTaskContractIdentity({ explicitChatTurn: true });
    const gate = assessAcceptanceByTaskType({ contract });
    expect(gate).toEqual({
      status: "not_required",
      reason: "chat_turn_contract_v1:no_external_acceptance",
    });
    expect(isInventedNotRequiredSuccess({ contract, acceptance: gate })).toBe(false);
  });

  it("A2: execution / code / unknown never invent not_required", () => {
    const cases = [
      buildTaskContractIdentity({ kind: "execution" }),
      buildTaskContractIdentity({ kind: "code" }),
      buildTaskContractIdentity({ kind: "document" }),
      buildTaskContractIdentity({ kind: "external_action" }),
      buildTaskContractIdentity({}), // unknown
    ];
    for (const c of cases) {
      const gate = assessAcceptanceByTaskType({ contract: c });
      expect(gate.status).toBe("pending");
      expect(
        isInventedNotRequiredSuccess({
          contract: c,
          acceptance: { status: "not_required", reason: "shortcut" },
        }),
      ).toBe(true);
    }
  });

  it("A3: requiredValidators → pending unless acceptanceVerified", () => {
    const contract = buildTaskContractIdentity({
      kind: "execution",
      requiredValidators: ["artifact_sha"],
    });
    expect(assessAcceptanceByTaskType({ contract }).status).toBe("pending");
    expect(assessAcceptanceByTaskType({ contract, acceptanceVerified: true }).status).toBe(
      "passed",
    );
  });

  it("A4: tip refuses invented not_required for non-chat_turn contract", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3-acc-"));
    try {
      const store = new DurableTaskOutcomeStore(dir);
      const service = new TaskOutcomeResultService({ store, submittedBy: "w3" });
      const chat = new ChatTaskOutcomeAdapter(service);
      const opened = chat.createOrRestore({
        taskId: "t-acc",
        scope,
        taskContractVersion: "1.0.0",
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) {
        return;
      }
      const setContract = service.submit(
        "t-acc",
        {
          type: "set_task_contract",
          taskContract: buildTaskContractIdentity({ kind: "execution" }),
          expectedVersion: opened.record.outcomeVersion,
          fencingToken: opened.fencingToken,
        },
        { requiredScope: scope },
      );
      expect(setContract.ok).toBe(true);
      if (!setContract.ok) {
        return;
      }
      const bad = service.submit(
        "t-acc",
        {
          type: "set_acceptance",
          acceptance: { status: "not_required", reason: "shortcut" },
          allowRetry: false,
          expectedVersion: setContract.record.outcomeVersion,
          fencingToken: opened.fencingToken,
        },
        { requiredScope: scope },
      );
      expect(bad.ok).toBe(false);
      if (bad.ok) {
        return;
      }
      expect(bad.code).toBe("illegal_transition");
      expect(bad.message).toMatch(/invented_not_required/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("W3 task-level total budget (pure)", () => {
  it("B1: resolveEffectiveTaskBudget tighten-only", () => {
    const ceiling = { maxIterations: 10, maxCostUsd: 50, maxDurationMinutes: 120 };
    expect(resolveEffectiveTaskBudget(ceiling, { maxCostUsd: 5 })).toEqual({
      maxIterations: 10,
      maxCostUsd: 5,
      maxDurationMinutes: 120,
    });
    expect(resolveEffectiveTaskBudget(ceiling, { maxCostUsd: 999 }).maxCostUsd).toBe(50);
    expect(resolveEffectiveTaskBudget(ceiling)).toEqual(ceiling);
  });

  it("B2: accumulate + exhaust iterations / cost / duration", () => {
    const base = buildTaskBudgetState({
      ceiling: { maxIterations: 2, maxCostUsd: 1, maxDurationMinutes: 1 },
    });
    const after1 = accumulateTaskBudgetSpend(base, { iterations: 1 }, 1_000);
    expect(assessTaskBudgetExhaustion(after1, 1_000)).toBeNull();
    const after2 = accumulateTaskBudgetSpend(after1, { iterations: 1 }, 1_000);
    expect(assessTaskBudgetExhaustion(after2, 1_000)?.dimension).toBe("iterations");

    const cost = applySpendAndAssess(base, { costUsd: 1.5 }, 1_000);
    expect(cost.exhaustion?.dimension).toBe("cost");

    const started = accumulateTaskBudgetSpend(base, { iterations: 0, costUsd: 0.01 }, 0);
    expect(assessTaskBudgetExhaustion(started, 61_000)?.dimension).toBe("duration");
  });
});

describe("W3 task-level total budget (tip + eligibility)", () => {
  let agentDir = "";

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "w3-budget-"));
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("B3: tip set_budget / accumulate / fail_closed budget_exceeded; no success eligibility", () => {
    const store = new DurableTaskOutcomeStore(agentDir);
    const service = new TaskOutcomeResultService({ store, submittedBy: "w3" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-budget",
      scope,
      taskContractVersion: "1.0.0",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }

    const budget = buildTaskBudgetState({
      ceiling: { maxIterations: 3, maxCostUsd: 1, maxDurationMinutes: 30 },
      taskLimits: { maxCostUsd: 0.5 },
    });
    expect(budget.maxCostUsd).toBe(0.5);

    const setBudget = service.submit(
      "t-budget",
      {
        type: "set_budget",
        budget,
        expectedVersion: opened.record.outcomeVersion,
        fencingToken: opened.fencingToken,
      },
      { requiredScope: scope },
    );
    expect(setBudget.ok).toBe(true);
    if (!setBudget.ok) {
      return;
    }
    expect(setBudget.record.budget?.maxCostUsd).toBe(0.5);

    const spent = service.submit(
      "t-budget",
      {
        type: "accumulate_budget_spend",
        costUsd: 0.6,
        iterations: 1,
        expectedVersion: setBudget.record.outcomeVersion,
        fencingToken: opened.fencingToken,
        nowMs: 5_000,
      },
      { requiredScope: scope },
    );
    expect(spent.ok).toBe(true);
    if (!spent.ok) {
      return;
    }
    expect(spent.record.budget?.spentCostUsd).toBeCloseTo(0.6);
    expect(spent.record.budget?.iterationCount).toBe(1);
    const exhaustion = assessTaskBudgetExhaustion(spent.record.budget!, 5_000);
    expect(exhaustion?.dimension).toBe("cost");

    const closed = service.submit(
      "t-budget",
      {
        type: "fail_closed",
        reasonCode: "budget_exceeded",
        reasonDetail: exhaustion!.detail,
        expectedVersion: spent.record.outcomeVersion,
        fencingToken: opened.fencingToken,
      },
      { requiredScope: scope },
    );
    expect(closed.ok).toBe(true);
    if (!closed.ok) {
      return;
    }
    expect(closed.record.lifecycle).toBe("closed");
    expect(closed.record.taskJudgement).toBe("failure");
    expect(closed.record.reasonCode).toBe("budget_exceeded");
    expect(closed.record.acceptance.status).not.toBe("not_required");

    const elig = computeEvaluationEligibility(closed.record);
    expect(elig.attribution).toBe("budget");
    expect(elig.countsSkillSuccessRate).toBe(false);
    expect(elig.countsGrowthNegative).toBe(false);
  });

  it("B4: create can embed budget + taskContract on tip", () => {
    const store = new DurableTaskOutcomeStore(agentDir);
    const service = new TaskOutcomeResultService({ store, submittedBy: "w3" });
    const contract = buildTaskContractIdentity({ kind: "code", requiredValidators: ["lint"] });
    const budget = buildTaskBudgetState({ taskLimits: { maxIterations: 2 } });
    const res = service.submit(
      "t-create",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: contract.version,
        taskContract: contract,
        budget,
      },
      { requiredScope: scope },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.record.taskContract?.kind).toBe("code");
    expect(res.record.budget?.maxIterations).toBe(2);
    expect(assessAcceptanceByTaskType({ contract: res.record.taskContract }).status).toBe(
      "pending",
    );
  });
});
