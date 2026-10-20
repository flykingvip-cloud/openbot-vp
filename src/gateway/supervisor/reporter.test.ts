import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSupervisorTaskEventSink } from "./events.js";
import { createJsonReporterPort } from "./reporter.js";
import { DEFAULT_SUPERVISOR_BUDGET, type SupervisedTask } from "./types.js";

function makeTask(taskId: string): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId,
    goal: "test reporting",
    repoRoot: `/repo/${taskId}`,
    worker: { backendId: "codex-cli" },
    workspace: { id: `ws-${taskId}`, root: `/ws/${taskId}`, kind: "directory" },
    acceptance: {
      steps: [{ id: "test", argv: ["npm", "test"], required: true }],
      source: "repo-detected",
    },
    state: "executing",
    iterations: [],
    budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

describe("reporter", () => {
  let dir = "";
  afterEach(() => {
    setSupervisorTaskEventSink(null);
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("writes progress event with truncated payload", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "sup-reporter-"));
    const reporter = createJsonReporterPort({ reportsDir: dir });
    const task = makeTask("t-progress-reporter");
    await reporter.progress?.(task, { type: "stdout", data: "x".repeat(1000) });
    const eventFile = path.join(dir, "t-progress-reporter.events.jsonl");
    const line = readFileSync(eventFile, "utf8").trim();
    const event = JSON.parse(line) as { type: string; kind: string; data: string };
    expect(event.type).toBe("progress");
    expect(event.kind).toBe("stdout");
    expect(event.data.endsWith("…")).toBe(true);
    expect(event.data.length).toBeLessThan(300);
  });

  it("emits live progress events when a sink is configured", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "sup-reporter-live-"));
    const sink = vi.fn();
    setSupervisorTaskEventSink(sink);
    const reporter = createJsonReporterPort({ reportsDir: dir });
    const task = makeTask("t-live");
    await reporter.progress?.(task, { type: "stdout", data: "hello" });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]?.[0]).toMatchObject({
      taskId: "t-live",
      type: "progress",
      progress: { kind: "stdout", data: "hello" },
    });
  });
});
