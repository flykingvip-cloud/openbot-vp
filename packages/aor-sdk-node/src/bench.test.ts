import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type BenchPolicyResult,
  PanelBackend,
  demoCatalog,
  demoFixtures,
  demoPolicies,
  demoTasks,
  runBenchmark,
} from "./bench.js";

function get(results: BenchPolicyResult[], name: string): BenchPolicyResult {
  const found = results.find((r) => r.policy === name);
  if (!found) {
    throw new Error(`policy not found: ${name}`);
  }
  return found;
}

describe("runBenchmark (objective, real node checks)", () => {
  it("shows AOR matching strong completion at lower cost and beating cheap completion", async () => {
    const { results } = await runBenchmark({
      tasks: demoTasks(),
      policies: demoPolicies(),
      modelCatalog: demoCatalog(),
      backend: new PanelBackend(demoFixtures()),
    });

    const strong = get(results, "single:claude");
    const cheap = get(results, "single:mini");
    const aor = get(results, "aor:auto");

    // Strong model completes everything but pays the most.
    expect(strong.avgCompletion).toBe(1);
    // Cheap model fails the coding tasks objectively.
    expect(cheap.avgCompletion).toBeLessThan(1);
    // AOR routes coding -> strong, summarization -> cheap: full completion.
    expect(aor.avgCompletion).toBe(1);

    // Plan threshold #1: cost down >= 30% vs the strong-only baseline.
    const costReductionVsStrong = 1 - aor.totalCostUsd / strong.totalCostUsd;
    expect(costReductionVsStrong).toBeGreaterThanOrEqual(0.3);

    // Plan threshold #2: completion up >= 20 points vs the cheap-only baseline.
    const completionGainVsCheap = aor.avgCompletion - cheap.avgCompletion;
    expect(completionGainVsCheap).toBeGreaterThanOrEqual(0.2);
  });

  it("routes each task type to the expected model", async () => {
    const { results } = await runBenchmark({
      tasks: demoTasks(),
      policies: [{ name: "aor:auto", strategy: "best_quality" }],
      modelCatalog: demoCatalog(),
      backend: new PanelBackend(demoFixtures()),
    });
    const aor = get(results, "aor:auto");
    const coding = aor.rows.filter((r) => r.taskType === "coding.review");
    const summ = aor.rows.filter((r) => r.taskType === "summarization");
    expect(coding.every((r) => r.model === "anthropic/claude-opus-4-6")).toBe(true);
    expect(summ.every((r) => r.model === "openai/gpt-5.4-mini")).toBe(true);
  });

  it("bandit policy meets stage 2 baselines after learning rounds", async () => {
    const { results } = await runBenchmark({
      tasks: demoTasks(),
      policies: demoPolicies(),
      modelCatalog: demoCatalog(),
      backend: new PanelBackend(demoFixtures()),
      banditRounds: 3,
    });

    const strong = get(results, "single:claude");
    const cheap = get(results, "single:mini");
    const aor = get(results, "aor:auto");
    const bandit = get(results, "aor:bandit");

    expect(bandit.avgCompletion).toBeGreaterThanOrEqual(aor.avgCompletion);
    const costReductionVsStrong = 1 - bandit.totalCostUsd / strong.totalCostUsd;
    expect(costReductionVsStrong).toBeGreaterThanOrEqual(0.3);
    const completionGainVsCheap = bandit.avgCompletion - cheap.avgCompletion;
    expect(completionGainVsCheap).toBeGreaterThanOrEqual(0.2);
  });

  it("records bandit learning curve snapshots across rounds", async () => {
    const { learningCurve } = await runBenchmark({
      tasks: demoTasks(),
      policies: [{ name: "aor:bandit", strategy: "bandit" }],
      modelCatalog: demoCatalog(),
      backend: new PanelBackend(demoFixtures()),
      banditRounds: 2,
    });
    expect(learningCurve.length).toBeGreaterThan(0);
    expect(learningCurve.some((s) => s.arms.length > 0)).toBe(true);
  });

  it("scores coding.review via workspace package.json test script in coding mode", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "aor-bench-coding-"));
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
      "utf8",
    );
    try {
      const { results } = await runBenchmark({
        tasks: demoTasks()
          .filter((t) => t.type === "coding.review")
          .slice(0, 1),
        policies: [{ name: "aor:auto", strategy: "best_quality" }],
        modelCatalog: demoCatalog(),
        backend: new PanelBackend(demoFixtures()),
        codingWorkspace: workspace,
      });
      expect(get(results, "aor:auto").avgCompletion).toBe(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("scores below 1 when workspace test script fails in coding mode", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "aor-bench-coding-fail-"));
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }),
      "utf8",
    );
    try {
      const { results } = await runBenchmark({
        tasks: demoTasks()
          .filter((t) => t.type === "coding.review")
          .slice(0, 1),
        policies: [{ name: "aor:auto", strategy: "best_quality" }],
        modelCatalog: demoCatalog(),
        backend: new PanelBackend(demoFixtures()),
        codingWorkspace: workspace,
      });
      expect(get(results, "aor:auto").avgCompletion).toBeLessThan(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("accumulates bandit trials across benchmark runs via banditStatePath", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aor-bench-bandit-"));
    const statePath = join(dir, "bandit.json");
    try {
      await runBenchmark({
        tasks: demoTasks().slice(0, 2),
        policies: [{ name: "aor:bandit", strategy: "bandit" }],
        modelCatalog: demoCatalog(),
        backend: new PanelBackend(demoFixtures()),
        banditRounds: 1,
        banditStatePath: statePath,
      });
      const { learningCurve } = await runBenchmark({
        tasks: demoTasks().slice(0, 2),
        policies: [{ name: "aor:bandit", strategy: "bandit" }],
        modelCatalog: demoCatalog(),
        backend: new PanelBackend(demoFixtures()),
        banditRounds: 1,
        banditStatePath: statePath,
      });
      const last = learningCurve.at(-1);
      const totalTrials = last?.arms.reduce((sum, a) => sum + a.trials, 0) ?? 0;
      expect(totalTrials).toBeGreaterThan(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
