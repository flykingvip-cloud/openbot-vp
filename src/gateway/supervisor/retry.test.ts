import { describe, expect, it } from "vitest";
import {
  acceptanceNotRelaxed,
  buildFixingPrompt,
  failedRequiredStepIds,
  isNoProgress,
  isWorkerExitRetryable,
  nextStop,
} from "./retry.js";
import { DEFAULT_SUPERVISOR_BUDGET, type SupervisedTask, type ValidationReport } from "./types.js";

function task(over: Partial<SupervisedTask> = {}): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId: "t1",
    goal: "ship feature",
    repoRoot: "/repo",
    worker: { backendId: "kiro-cli" },
    workspace: { id: "ws-t1", root: "/ws/t1", kind: "directory" },
    acceptance: {
      steps: [
        { id: "test", argv: ["npm", "test"], required: true },
        { id: "lint", argv: ["npm", "run", "lint"], required: true },
      ],
      source: "repo-detected",
    },
    state: "fixing",
    iterations: [],
    budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 0, startedAtMs: Date.now() },
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function failReport(ids: string[]): ValidationReport {
  return {
    passed: false,
    at: new Date().toISOString(),
    steps: ids.map((id) => ({
      id,
      argv: ["npm", "test"],
      exitCode: 1,
      ok: false,
      durationMs: 1,
    })),
  };
}

describe("retry — nextStop gates", () => {
  it("stops at max_iterations", () => {
    const t = task({
      iterations: Array.from({ length: 5 }, (_, i) => ({
        index: i,
        startedAt: new Date().toISOString(),
        validation: failReport(["test"]),
      })),
    });
    expect(nextStop(t)).toBe("max_iterations");
  });

  it("stops at budget_exhausted", () => {
    const t = task({
      budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 10, startedAtMs: Date.now() },
    });
    expect(nextStop(t)).toBe("budget_exhausted");
  });

  it("stops at timed_out", () => {
    const started = Date.now() - 31 * 60_000;
    const t = task({
      budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 0, startedAtMs: started },
    });
    expect(nextStop(t, Date.now())).toBe("timed_out");
  });

  it("stops at escalated when no progress", () => {
    const report = failReport(["test", "lint"]);
    const t = task({
      iterations: [
        { index: 0, startedAt: new Date().toISOString(), validation: report },
        { index: 1, startedAt: new Date().toISOString(), validation: report },
      ],
    });
    expect(isNoProgress(t)).toBe(true);
    expect(nextStop(t)).toBe("escalated");
  });

  it("returns null when retry is still allowed", () => {
    const t = task({
      iterations: [
        { index: 0, startedAt: new Date().toISOString(), validation: failReport(["test"]) },
      ],
    });
    expect(nextStop(t)).toBeNull();
  });
});

describe("retry — fixing prompt + retryable exits", () => {
  it("buildFixingPrompt includes redacted failure lines", () => {
    const prompt = buildFixingPrompt(
      task(),
      failReport(["test"]).steps.length
        ? {
            ...failReport(["test"]),
            steps: [
              {
                id: "test",
                argv: ["npm", "test"],
                exitCode: 1,
                ok: false,
                stderrSummary: "assertion failed",
                durationMs: 2,
              },
            ],
          }
        : failReport(["test"]),
    );
    expect(prompt).toContain("assertion failed");
    expect(prompt).toContain("ship feature");
  });

  it("isWorkerExitRetryable honors retryableExitCodes", () => {
    expect(isWorkerExitRetryable(1, [1, 2])).toBe(true);
    expect(isWorkerExitRetryable(9, [1, 2])).toBe(false);
    expect(isWorkerExitRetryable(9, [])).toBe(true);
  });

  it("acceptanceNotRelaxed rejects relaxed required steps", () => {
    const base = task().acceptance;
    const relaxed = {
      ...base,
      steps: base.steps.map((s) => (s.id === "lint" ? { ...s, required: false } : s)),
    };
    expect(acceptanceNotRelaxed(base, relaxed)).toBe(false);
    expect(acceptanceNotRelaxed(base, base)).toBe(true);
  });

  it("failedRequiredStepIds tracks required failures only", () => {
    const report: ValidationReport = {
      passed: false,
      at: new Date().toISOString(),
      steps: [
        { id: "test", argv: [], exitCode: 1, ok: false, durationMs: 1 },
        { id: "lint", argv: [], exitCode: 1, ok: false, durationMs: 1 },
      ],
    };
    expect(failedRequiredStepIds(report, task().acceptance)).toEqual(["lint", "test"]);
  });
});
