/**
 * Residual four items after W2–W5 wrap-up (#117):
 * 1) W1 entry inventory — real production call sites only; subagent intentional skip
 * 2) Non-chat tip.budget via shared recordRunnerTurnOutcome (iteration accumulate/exhaust)
 * 3) Explicit adopted upstream → Option A verify; inject alone never verifies
 * 4) evolution recordRunOutcome bypass — inventory only unless tip→growth-bridge covers all
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingLearningInjectionsForTests,
  rememberPendingLearningInjection,
} from "../auto-reply/reply/learning-experience-pending.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import { resolveExperienceVerificationPlan } from "./experience-verified-handler.js";
import {
  attachAdoptedLearningAssetsToTask,
  mergeAdoptedIntoExperienceExposure,
} from "./learning-adoption.js";
import { recordRunnerTurnOutcome } from "./runtime-from-runner.js";
import type { ExperienceExposureState, TrustedScope } from "./types.js";

const root = process.cwd();

function personalScope(subject = "subject:residual"): TrustedScope {
  return {
    kind: "personal",
    personalDomainId: `personal:${subject}`,
    subjectRef: subject,
    authzScopeRef: "residual-test",
  };
}

describe("residual 1: W1 entry inventory (real call sites)", () => {
  it("gateway server-methods/agent dispatches via agentCommandFromIngress (already wired)", () => {
    const src = fs.readFileSync(path.join(root, "src/gateway/server-methods/agent.ts"), "utf8");
    expect(src).toMatch(/agentCommandFromIngress/);
    expect(src).toMatch(/dispatchAgentRunFromGateway/);
  });

  it("commands/agent opens a subagent tip and gates the model call", () => {
    const src = fs.readFileSync(path.join(root, "src/commands/agent.ts"), "utf8");
    expect(src).toMatch(/ensureSubagentTurnTaskOutcome/);
    expect(src).toMatch(/assertRunnerTurnBudgetAllowsModelCall/);
    expect(src).toMatch(/chargeModelCallAgainstTip/);
    expect(src).toMatch(/entrypoint: "subagent"|"subagent"/);
    expect(src).not.toMatch(/skip nested subagent lane/);
  });

  it("collab claim-contract-entry is the production ensureCollab site", () => {
    const src = fs.readFileSync(
      path.join(root, "src/gateway/collaboration-learning/claim-contract-entry.ts"),
      "utf8",
    );
    expect(src).toMatch(/ensureCollabTurnTaskOutcome/);
    expect(src).toMatch(/recordRunnerTurnOutcome/);
  });

  it("cron isolated-agent run ensureCron + recordRunnerTurnOutcome", () => {
    const src = fs.readFileSync(path.join(root, "src/cron/isolated-agent/run.ts"), "utf8");
    expect(src).toMatch(/ensureCronTurnTaskOutcome/);
    expect(src).toMatch(/recordRunnerTurnOutcome/);
  });
});

describe("residual 2: non-chat tip.budget via recordRunnerTurnOutcome", () => {
  let agentDir = "";
  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "residual-budget-"));
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  for (const entrypoint of ["cron", "cli", "collab", "gateway_agent"] as const) {
    it(`${entrypoint}: retries accumulate; exhaust → budget_exceeded`, async () => {
      const cfg = {
        agents: { list: [{ id: "bot", workspace: agentDir }] },
      } as never;
      const taskId = `${entrypoint}:bot:residual-budget`;
      const scope = personalScope();

      const a1 = await recordRunnerTurnOutcome(cfg, "bot", {
        success: true,
        runId: `${entrypoint}-r1`,
        taskId,
        scope,
        entrypoint,
        budgetLimits: { maxIterations: 2, maxCostUsd: 10, maxDurationMinutes: 30 },
      });
      expect(a1.record.budget?.iterationCount).toBe(1);
      expect(a1.record.entrypoint).toBe(entrypoint);
      expect(a1.record.reasonCode).not.toBe("budget_exceeded");

      const a2 = await recordRunnerTurnOutcome(cfg, "bot", {
        success: true,
        runId: `${entrypoint}-r2`,
        taskId,
        scope,
        entrypoint,
      });
      expect(a2.record.budget?.iterationCount).toBeGreaterThanOrEqual(2);
      expect(a2.record.reasonCode).toBe("budget_exceeded");
      expect(a2.record.lifecycle).toBe("closed");
    });
  }

  it("costUsd spend accumulates when caller passes real USD (no invent)", async () => {
    const cfg = {
      agents: { list: [{ id: "bot", workspace: agentDir }] },
    } as never;
    const taskId = "cron:bot:cost-usd";
    const scope = personalScope("subject:cost");
    const a1 = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "c1",
      taskId,
      scope,
      entrypoint: "cron",
      costUsd: 0.4,
      budgetLimits: { maxIterations: 10, maxCostUsd: 0.5, maxDurationMinutes: 30 },
    });
    expect(a1.record.budget?.spentCostUsd).toBeGreaterThanOrEqual(0.4);
    expect(a1.record.reasonCode).not.toBe("budget_exceeded");

    const a2 = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "c2",
      taskId,
      scope,
      entrypoint: "cron",
      costUsd: 0.2,
    });
    expect(a2.record.reasonCode).toBe("budget_exceeded");
  });
});

describe("residual 3: adopted upstream explicit only", () => {
  let agentDir = "";
  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "residual-adopt-"));
    clearPendingLearningInjectionsForTests();
  });
  afterEach(() => {
    clearPendingLearningInjectionsForTests();
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("merge helper never invents exposure or copies non-exposed ids", () => {
    expect(mergeAdoptedIntoExperienceExposure(undefined, ["a1"])).toBeUndefined();
    const exposure: ExperienceExposureState = {
      scopes: [{ scopeId: "s1", botId: "bot", assetIds: ["a1"] }],
      attachedAt: new Date().toISOString(),
    };
    expect(mergeAdoptedIntoExperienceExposure(exposure, ["other"])).toBeUndefined();
    const merged = mergeAdoptedIntoExperienceExposure(exposure, ["a1", "other"]);
    expect(merged?.adoptedAssetIds).toEqual(["a1"]);
  });

  it("inject/success without adopted → 成功任务中的曝光 (no verify plan)", () => {
    const exposure: ExperienceExposureState = {
      scopes: [{ scopeId: "s1", botId: "bot", assetIds: ["x1"] }],
      attachedAt: new Date().toISOString(),
    };
    const plan = resolveExperienceVerificationPlan({
      lifecycle: "closed",
      taskJudgement: "success",
      reasonCode: undefined,
      acceptance: { status: "passed" },
      delivery: { status: "delivered" },
      experienceExposure: exposure,
    } as never);
    expect(plan.shouldVerify).toBe(false);
    expect(plan.reason).toBe("exposure_on_success_not_verified");
  });

  it("attachAdoptedLearningAssetsToTask writes tip adopted; plan verifies when closed+eligible", async () => {
    const cfg = {
      agents: { list: [{ id: "bot", workspace: agentDir }] },
    } as never;
    rememberPendingLearningInjection({
      key: "run:adopt-run",
      scopes: [{ scopeId: "s1", botId: "bot", assetIds: ["lesson-1"] }],
    });
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "adopt-run",
      sessionKey: "sess",
      subjectRef: "subject:u",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.record.experienceExposure?.scopes[0]?.assetIds).toEqual(["lesson-1"]);

    const attached = await attachAdoptedLearningAssetsToTask(cfg, "bot", {
      taskId: opened.taskId,
      scope: opened.scope,
      adoptedAssetIds: ["lesson-1"],
      fencingToken: opened.fencingToken,
    });
    expect(attached.ok).toBe(true);
    if (!attached.ok) {
      return;
    }
    expect(attached.mergedIds).toEqual(["lesson-1"]);
    expect(attached.record.experienceExposure?.adoptedAssetIds).toEqual(["lesson-1"]);

    // recordRunnerTurnOutcome merges explicit adopted again (idempotent).
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "adopt-run",
      taskId: opened.taskId,
      scope: opened.scope,
      adoptedAssetIds: ["lesson-1"],
    });
    expect(out.record.experienceExposure?.adoptedAssetIds).toContain("lesson-1");

    const closedLike = {
      ...attached.record,
      lifecycle: "closed" as const,
      taskJudgement: "success" as const,
      acceptance: { status: "passed" as const },
      delivery: { status: "delivered" as const },
      experienceExposure: attached.record.experienceExposure,
    };
    const plan = resolveExperienceVerificationPlan(closedLike as never);
    expect(plan.shouldVerify).toBe(true);
    expect(plan.reason).toBe("tip_success_eligible_adopted");
    expect(plan.scopes[0]?.assetIds).toEqual(["lesson-1"]);
  });

  it("attach without tip exposure fails (no agentId guess)", async () => {
    const cfg = {
      agents: { list: [{ id: "bot", workspace: agentDir }] },
    } as never;
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "no-exp",
      subjectRef: "subject:u",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const attached = await attachAdoptedLearningAssetsToTask(cfg, "bot", {
      taskId: opened.taskId,
      scope: opened.scope,
      adoptedAssetIds: ["ghost"],
      fencingToken: opened.fencingToken,
    });
    expect(attached.ok).toBe(false);
    if (attached.ok) {
      return;
    }
    expect(attached.code).toBe("missing_exposure");
  });
});

describe("residual 4: evolution bypass inventory (do not retire without proof)", () => {
  it("growth-bridge remains the tip→evolution path; recordRunOutcome still has prod callers", () => {
    const growth = fs.readFileSync(path.join(root, "src/task-outcome/growth-bridge.ts"), "utf8");
    expect(growth).toMatch(/publishEvolutionFromTaskOutcome/);
    expect(growth).toMatch(/appendEvolutionTaskOutcome/);

    const metrics = fs.readFileSync(
      path.join(root, "src/gateway/agent-growth/operational-metrics-store.ts"),
      "utf8",
    );
    expect(metrics).toMatch(/export async function recordRunOutcome/);
    expect(metrics).toMatch(/appendEvolutionTaskOutcome/);

    const evoRpc = fs.readFileSync(
      path.join(root, "src/gateway/server-methods/evolution-control.ts"),
      "utf8",
    );
    expect(evoRpc).toMatch(/recordRunOutcome/);

    const dna = fs.readFileSync(
      path.join(root, "src/gateway/evolution-control/adapters/working-dna.ts"),
      "utf8",
    );
    expect(dna).toMatch(/readEffectiveEvolutionTaskOutcomes/);
  });

  it("call-chain documents bypass not retired + residual blockers", () => {
    const callChain = fs.readFileSync(
      path.join(root, "docs/design/task-outcome/call-chain-and-replacements.md"),
      "utf8",
    );
    expect(callChain).toMatch(/recordRunOutcome/);
    expect(callChain).toMatch(/旁路/);
    expect(callChain).toMatch(/未退役|不退役|不删除|inventory/);
    expect(callChain).toMatch(/子 agent|subagent/i);
  });
});
