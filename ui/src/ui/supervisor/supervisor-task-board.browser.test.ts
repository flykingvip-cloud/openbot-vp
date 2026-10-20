// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import type { SupervisorTaskBoard } from "./supervisor-task-board.ts";
import "./supervisor-task-board.ts";
import { SUPERVISOR_TASK_EVENT } from "./supervisor-types.ts";

function mount(): SupervisorTaskBoard {
  const el = document.createElement("supervisor-task-board");
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flush(el: HTMLElement) {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await Promise.resolve();
}

describe("<supervisor-task-board>", () => {
  it("shows unavailable when gateway reports UNAVAILABLE", async () => {
    const request = vi.fn(async () => {
      throw new GatewayRequestError({ code: "UNAVAILABLE", message: "supervisor is not enabled" });
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request, connected: true } as unknown;
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("监督子系统未启用");
  });

  it("appends live events for the selected task", async () => {
    const task = {
      taskId: "sup_live",
      goal: "goal",
      repoRoot: "/r",
      state: "executing",
      worker: { backendId: "codex-cli" },
      iterations: [],
      budget: { spentCostUsd: 0, maxIterations: 5, maxCostUsd: 5 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "supervisor.task.list") {
        return { tasks: [task] };
      }
      if (method === "supervisor.runner.status") {
        return {
          enabled: false,
          ownerId: "runner-test",
          maxConcurrency: 4,
          activeTicks: 0,
          activeLeases: 0,
          queuedCandidates: 1,
          lastSweepAtMs: null,
          lastSweepDriven: 0,
        };
      }
      if (method === "supervisor.task.get") {
        return task;
      }
      if (method === "supervisor.task.subscribe") {
        return { taskId: params?.taskId, subscribed: true };
      }
      return {};
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request, connected: true } as unknown;
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("今日监督队列");
    const row = el.querySelector(".employee-supervisor-center__list-item");
    expect(row).toBeTruthy();
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("返回任务列表");
    expect(el.querySelector(".employee-supervisor-center__panel")).toBeTruthy();
    window.dispatchEvent(
      new CustomEvent(SUPERVISOR_TASK_EVENT, {
        detail: {
          taskId: "sup_live",
          type: "progress",
          at: new Date().toISOString(),
          progress: { kind: "stdout", data: "hello" },
        },
      }),
    );
    await flush(el);
    expect(el.textContent).toContain("hello");
  });

  it("shows daibai entry CTA on empty task list", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.task.list") {
        return { tasks: [] };
      }
      if (method === "supervisor.runner.status") {
        return {
          enabled: true,
          ownerId: "runner-test",
          maxConcurrency: 4,
          activeTicks: 0,
          activeLeases: 0,
          queuedCandidates: 0,
          lastSweepAtMs: null,
          lastSweepDriven: 0,
        };
      }
      if (method === "supervisor.worker.list") {
        return { workers: [] };
      }
      if (method === "supervisor.worker.health") {
        return { workers: [] };
      }
      if (method === "supervisor.task.templates.list") {
        return { templates: [], repoAutoTemplateId: "repo-auto" };
      }
      return {};
    });
    const onOpenDaibaiForDevTask = vi.fn();
    const el = mount();
    el.tenantId = "t1";
    el.client = { request } as unknown as SupervisorTaskBoard["client"];
    el.onOpenDaibaiForDevTask = onOpenDaibaiForDevTask;
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("去大白创建");
    const btn = Array.from(el.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("去大白创建"),
    );
    btn?.click();
    expect(onOpenDaibaiForDevTask).toHaveBeenCalledTimes(1);
  });

  it("shows terminal round label without bare fraction", async () => {
    const task = {
      taskId: "sup_term",
      goal: "done goal",
      repoRoot: "/r",
      state: "max_iterations",
      worker: { backendId: "codex-cli" },
      iterations: Array.from({ length: 174 }, (_, index) => ({
        index,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      })),
      budget: { spentCostUsd: 0, maxIterations: 5, maxCostUsd: 5 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.task.list") {
        return { tasks: [task] };
      }
      if (method === "supervisor.runner.status") {
        return {
          enabled: false,
          ownerId: "runner-test",
          maxConcurrency: 4,
          activeTicks: 0,
          activeLeases: 0,
          queuedCandidates: 0,
          lastSweepAtMs: null,
          lastSweepDriven: 0,
        };
      }
      return {};
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request, connected: true } as unknown;
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("已用 174 轮 · 上限 5");
    expect(el.textContent).not.toMatch(/(^|\s)174\s*\/\s*5(\s|$)/);
    expect(el.textContent).toContain("达最大迭代");
  });
});
