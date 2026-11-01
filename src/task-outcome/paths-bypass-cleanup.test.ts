/**
 * Paths / bypass cleanup after residual #120:
 * - non-chat (and followup) closeout pass real usage-derived costUsd into shared tip budget
 * - evolution recordRunOutcome skips append when tip→growth-bridge already published the run
 * - adopted upstream / subagent / full evolution retirement remain inventory-only
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { recordRunOutcome } from "../gateway/agent-growth/operational-metrics-store.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import { hasTipBridgedEvolutionForRun } from "./growth-bridge.js";
import {
  estimateTipBudgetCostUsdFromUsage,
  recordRunnerTurnOutcome,
} from "./runtime-from-runner.js";
import type { TrustedScope } from "./types.js";

const root = process.cwd();

function personalScope(subject = "subject:paths"): TrustedScope {
  return {
    kind: "personal",
    personalDomainId: `personal:${subject}`,
    subjectRef: subject,
    authzScopeRef: "paths-cleanup",
  };
}

describe("paths cleanup: estimateTipBudgetCostUsdFromUsage", () => {
  it("returns undefined without inventing when usage/cost missing", () => {
    expect(estimateTipBudgetCostUsdFromUsage({})).toBeUndefined();
    expect(
      estimateTipBudgetCostUsdFromUsage({
        usage: { input: 100, output: 50 },
        provider: "openai",
        model: "gpt-test",
      }),
    ).toBeUndefined();
  });

  it("estimates when model cost config is present", () => {
    const cfg = {
      models: {
        providers: {
          openai: {
            models: [
              {
                id: "gpt-test",
                cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
    } as never;
    const cost = estimateTipBudgetCostUsdFromUsage({
      usage: { input: 1_000_000, output: 500_000 },
      provider: "openai",
      model: "gpt-test",
      config: cfg,
    });
    expect(cost).toBeGreaterThan(0);
  });
});

describe("paths cleanup: production call sites pass costUsd (source inventory)", () => {
  it("cron isolated-agent run wires estimateTipBudgetCostUsdFromUsage into closeout", () => {
    const src = fs.readFileSync(path.join(root, "src/cron/isolated-agent/run.ts"), "utf8");
    expect(src).toMatch(/estimateTipBudgetCostUsdFromUsage/);
    expect(src).toMatch(/costUsd: tipBudgetCostUsd/);
  });

  it("followup-runner wires estimateTipBudgetCostUsdFromUsage into closeout", () => {
    const src = fs.readFileSync(path.join(root, "src/auto-reply/reply/followup-runner.ts"), "utf8");
    expect(src).toMatch(/estimateTipBudgetCostUsdFromUsage/);
    expect(src).toMatch(/costUsd: tipBudgetCostUsd/);
  });

  it("commands/agent wires estimateTipBudgetCostUsdFromUsage into cli/gateway closeout", () => {
    const src = fs.readFileSync(path.join(root, "src/commands/agent.ts"), "utf8");
    expect(src).toMatch(/estimateTipBudgetCostUsdFromUsage/);
    expect(src).toMatch(/costUsd: tipBudgetCostUsd/);
  });

  it("collab claim closeout still has no invented costUsd (no model usage source)", () => {
    const src = fs.readFileSync(
      path.join(root, "src/gateway/collaboration-learning/claim-contract-entry.ts"),
      "utf8",
    );
    expect(src).toMatch(/recordRunnerTurnOutcome/);
    expect(src).not.toMatch(/costUsd/);
  });
});

describe("paths cleanup: non-chat tip.budget accumulates explicit costUsd", () => {
  let agentDir = "";
  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "paths-budget-"));
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  for (const entrypoint of ["cron", "cli", "gateway_agent"] as const) {
    it(`${entrypoint}: costUsd from caller accumulates on tip.budget`, async () => {
      const cfg = {
        agents: { list: [{ id: "bot", workspace: agentDir }] },
      } as never;
      const taskId = `${entrypoint}:bot:paths-cost`;
      const out = await recordRunnerTurnOutcome(cfg, "bot", {
        success: true,
        runId: `${entrypoint}-cost-1`,
        taskId,
        scope: personalScope(),
        entrypoint,
        costUsd: 0.25,
        budgetLimits: { maxIterations: 10, maxCostUsd: 1, maxDurationMinutes: 30 },
      });
      expect(out.record.budget?.spentCostUsd).toBeGreaterThanOrEqual(0.25);
      expect(out.record.entrypoint).toBe(entrypoint);
    });
  }
});

describe("paths cleanup: evolution bypass skips when tip already bridged", () => {
  let agentDir = "";
  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "paths-evo-"));
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("recordRunOutcome still appends when no tip sample for runId", async () => {
    const cfg = {
      agents: { list: [{ id: "bot", workspace: agentDir }] },
    } as never;
    await recordRunOutcome(cfg, "bot", {
      success: true,
      runId: "bypass-only-run",
      tenantId: "tenant-paths",
    });
    const rows = readEvolutionTaskOutcomes(cfg, "bot");
    expect(rows.some((r) => r.runId === "bypass-only-run" && r.succeeded)).toBe(true);
    expect(hasTipBridgedEvolutionForRun(cfg, "bot", "bypass-only-run")).toBe(false);
  });

  it("recordRunOutcome skips evolution append after tip→growth-bridge publish", async () => {
    const cfg = {
      agents: { list: [{ id: "bot", workspace: agentDir }] },
    } as never;
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "tip-then-bypass",
      sessionKey: "sess-paths",
      subjectRef: "subject:paths",
      tenantId: "tenant-paths",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const closed = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "tip-then-bypass",
      taskId: opened.taskId,
      scope: opened.scope,
      entrypoint: "chat",
      acceptance: { status: "passed" },
      delivery: { status: "delivered" },
      deliveryId: "receipt:paths",
    });
    expect(closed.record.lifecycle).toBe("closed");
    expect(hasTipBridgedEvolutionForRun(cfg, "bot", "tip-then-bypass")).toBe(true);
    const before = readEvolutionTaskOutcomes(cfg, "bot").filter(
      (r) => r.runId === "tip-then-bypass",
    ).length;

    await recordRunOutcome(cfg, "bot", {
      success: true,
      runId: "tip-then-bypass",
      tenantId: "tenant-paths",
    });
    const after = readEvolutionTaskOutcomes(cfg, "bot").filter(
      (r) => r.runId === "tip-then-bypass",
    ).length;
    expect(after).toBe(before);
  });
});

describe("paths cleanup: honest inventory still holds", () => {
  it("subagent lane opens TaskOutcome and gates the next model call", () => {
    const src = fs.readFileSync(path.join(root, "src/commands/agent.ts"), "utf8");
    expect(src).toMatch(/ensureSubagentTurnTaskOutcome/);
    expect(src).toMatch(/assertRunnerTurnBudgetAllowsModelCall/);
    expect(src).not.toMatch(/skip nested subagent lane/);
  });

  it("attachAdoptedLearningAssetsToTask remains the only explicit adopted API", () => {
    const src = fs.readFileSync(path.join(root, "src/task-outcome/learning-adoption.ts"), "utf8");
    expect(src).toMatch(/export async function attachAdoptedLearningAssetsToTask/);
    expect(src).toMatch(/adoptedAssetIds required \(explicit\)/);
  });

  it("evolution-control RPC still calls recordRunOutcome (bypass not retired)", () => {
    const src = fs.readFileSync(
      path.join(root, "src/gateway/server-methods/evolution-control.ts"),
      "utf8",
    );
    expect(src).toMatch(/evolution\.task-outcomes\.record/);
    expect(src).toMatch(/recordRunOutcome/);
  });
});
