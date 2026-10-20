// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "./supervisor-panel.ts";
import type { SupervisorGovernanceSection } from "./supervisor-panel.ts";

function mount(): SupervisorGovernanceSection {
  const el = document.createElement("supervisor-governance-section");
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

describe("<supervisor-governance-section>", () => {
  it("renders the task board shell without client", async () => {
    const el = mount();
    await flush(el);
    expect(el.textContent).toContain("开发监督者");
  });

  it("loads task list when client is provided", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.status") {
        return { enabled: false, envEnabled: false, configEnabled: false, runnerEnabled: false };
      }
      if (method === "supervisor.task.list") {
        return { tasks: [] };
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
      if (method === "supervisor.template.list") {
        return { templates: [], repoAutoTemplateId: "repo-auto" };
      }
      if (method === "supervisor.worker.list") {
        return { workers: [] };
      }
      if (method === "supervisor.worker.health") {
        return { workers: [] };
      }
      if (method === "supervisor.node.list") {
        return { nodes: [] };
      }
      return {};
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request, connected: true } as unknown;
    await flush(el);
    await new Promise((r) => setTimeout(r, 50));
    await flush(el);
    expect(el.textContent).toContain("Node 与席位绑定");
    expect(el.textContent).toContain("Worker 执行策略");
    expect(el.textContent).toContain("当前租户");
    expect(request).toHaveBeenCalledWith("supervisor.status", {});
    expect(request).toHaveBeenCalledWith("supervisor.task.list", {});
    expect(request).toHaveBeenCalledWith("supervisor.node.list", {});
  });
});
