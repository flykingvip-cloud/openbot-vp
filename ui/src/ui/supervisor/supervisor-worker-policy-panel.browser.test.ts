// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupervisorWorkerPolicyPanel } from "./supervisor-worker-policy-panel.ts";
import "./supervisor-worker-policy-panel.ts";

function mount(): SupervisorWorkerPolicyPanel {
  const el = document.createElement("supervisor-worker-policy-panel");
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

describe("<supervisor-worker-policy-panel>", () => {
  it("merges worker list with tenant policies", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.worker.list") {
        return {
          workers: [{ backendId: "cursor-cli", control: [], taskCapabilities: [], models: [] }],
        };
      }
      if (method === "supervisor.worker.policy.list") {
        return { policies: [] };
      }
      return {};
    });
    const el = mount();
    el.tenantId = "t1";
    el.client = { request, connected: true } as unknown as SupervisorWorkerPolicyPanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    Array.from(el.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("加载策略"))
      ?.click();
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("cursor-cli");
    expect(el.textContent).toContain("系统默认");
    expect(el.textContent).toContain("本机 IDE 登录");
  });

  it("hides edit controls in read-only enterprise mode", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.worker.list") {
        return {
          workers: [{ backendId: "cursor-cli", control: [], taskCapabilities: [], models: [] }],
        };
      }
      if (method === "supervisor.worker.policy.list") {
        return { policies: [] };
      }
      return {};
    });
    const el = mount();
    el.tenantId = "t1";
    el.editable = false;
    el.client = { request, connected: true } as unknown as SupervisorWorkerPolicyPanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("只读视图");
    expect(el.querySelector("button.btn--primary")).toBeNull();
    expect(el.textContent).not.toContain("编辑");
  });
});
