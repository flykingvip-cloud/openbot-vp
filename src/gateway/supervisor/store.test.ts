import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTask,
  getTask,
  listActiveTasks,
  listTasks,
  resumeActive,
  updateTask,
} from "./store.js";
import {
  DEFAULT_SUPERVISOR_BUDGET,
  isTerminalTaskState,
  resolveEffectiveBudget,
  type SupervisedTask,
} from "./types.js";

function makeTask(taskId: string, state: SupervisedTask["state"] = "planned"): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId,
    goal: "implement login",
    repoRoot: `/repo/${taskId}`,
    worker: { backendId: "kiro-cli" },
    workspace: { id: `ws-${taskId}`, root: `/ws/${taskId}`, kind: "directory" },
    acceptance: {
      steps: [{ id: "test", argv: ["npm", "test"], required: true }],
      source: "repo-detected",
    },
    state,
    iterations: [],
    budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

describe("types — budget + terminal helpers", () => {
  it("resolveEffectiveBudget lets the task only tighten the tenant ceiling", () => {
    const tenant = { maxIterations: 10, maxCostUsd: 50, maxDurationMinutes: 120 };
    expect(resolveEffectiveBudget(tenant, { maxCostUsd: 5 })).toEqual({
      maxIterations: 10,
      maxCostUsd: 5,
      maxDurationMinutes: 120,
    });
    // task attempting to loosen is clamped to the tenant ceiling
    expect(resolveEffectiveBudget(tenant, { maxCostUsd: 999 }).maxCostUsd).toBe(50);
    // no task override → tenant ceiling
    expect(resolveEffectiveBudget(tenant)).toEqual(tenant);
  });

  it("isTerminalTaskState classifies terminal vs active", () => {
    expect(isTerminalTaskState("accepted")).toBe(true);
    expect(isTerminalTaskState("escalated")).toBe(true);
    expect(isTerminalTaskState("budget_exhausted")).toBe(true);
    expect(isTerminalTaskState("executing")).toBe(false);
    expect(isTerminalTaskState("planned")).toBe(false);
  });
});

describe("store — runtime persistence (temp dir, no real config)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sup-store-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("create → get round-trip; duplicate create rejected", async () => {
    await createTask(makeTask("t1"), dir);
    expect((await getTask("t1", dir))?.goal).toBe("implement login");
    await expect(createTask(makeTask("t1"), dir)).rejects.toThrow(/already exists/);
  });

  it("getTask returns null for unknown id", async () => {
    expect(await getTask("nope", dir)).toBeNull();
  });

  it("updateTask is atomic + stamps updatedAt; unknown id rejects", async () => {
    await createTask(makeTask("t1"), dir);
    const updated = await updateTask("t1", (t) => ({ ...t, state: "executing" }), dir);
    expect(updated.state).toBe("executing");
    expect((await getTask("t1", dir))?.state).toBe("executing");
    await expect(updateTask("missing", (t) => t, dir)).rejects.toThrow(/not found/);
  });

  it("serial updates do not lose writes (read-modify-write under queue)", async () => {
    await createTask({ ...makeTask("t1"), iterations: [] }, dir);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        updateTask(
          "t1",
          (t) => ({
            ...t,
            iterations: [...t.iterations, { index: i, startedAt: new Date().toISOString() }],
          }),
          dir,
        ),
      ),
    );
    expect((await getTask("t1", dir))?.iterations).toHaveLength(10);
  });

  it("listTasks / listActiveTasks filter terminal states", async () => {
    await createTask(makeTask("t1", "executing"), dir);
    await createTask(makeTask("t2", "accepted"), dir);
    await createTask(makeTask("t3", "planned"), dir);
    expect((await listTasks(dir)).length).toBe(3);
    expect((await listActiveTasks(dir)).map((t) => t.taskId).toSorted()).toEqual(["t1", "t3"]);
  });

  it("resumeActive drives only non-terminal tasks and isolates failures", async () => {
    await createTask(makeTask("t1", "executing"), dir);
    await createTask(makeTask("t2", "accepted"), dir);
    await createTask(makeTask("t3", "validating"), dir);
    const driven: string[] = [];
    const count = await resumeActive(async (t) => {
      driven.push(t.taskId);
      if (t.taskId === "t1") {
        throw new Error("boom"); // isolated
      }
    }, dir);
    expect(count).toBe(2);
    expect(driven.toSorted()).toEqual(["t1", "t3"]);
  });
});
