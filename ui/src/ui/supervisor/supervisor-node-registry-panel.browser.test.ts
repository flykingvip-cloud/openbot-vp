// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import type { SupervisorNodeRegistryPanel } from "./supervisor-node-registry-panel.ts";
import "./supervisor-node-registry-panel.ts";

function mount(): SupervisorNodeRegistryPanel {
  const el = document.createElement("supervisor-node-registry-panel");
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

describe("<supervisor-node-registry-panel>", () => {
  it("lists online nodes on connect", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.node.list") {
        return {
          nodes: [
            {
              nodeId: "mac-1",
              online: true,
              supportsSupervisorWorker: true,
              supervisorWorkerCommands: ["supervisor.worker.dispatch"],
              connectedAtMs: Date.now(),
              displayName: "Daniel Mac",
              platform: "macos",
            },
          ],
        };
      }
      return {};
    });
    const el = mount();
    el.client = { request, connected: true } as unknown as SupervisorNodeRegistryPanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("mac-1");
    expect(el.textContent).toContain("Daniel Mac");
  });

  it("loads bindings for tenant and emits tenant change", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.node.list") {
        return {
          nodes: [
            {
              nodeId: "mac-1",
              online: true,
              supportsSupervisorWorker: true,
              supervisorWorkerCommands: [],
              connectedAtMs: 0,
            },
          ],
        };
      }
      if (method === "supervisor.node.bindings.list") {
        return {
          bindings: [
            {
              tenantId: "t1",
              seatId: "seat-9",
              nodeId: "mac-1",
              updatedAt: "2026-06-18T00:00:00.000Z",
            },
          ],
        };
      }
      if (method === "supervisor.node.bindingRequest.list") {
        return { requests: [] };
      }
      return {};
    });
    const el = mount();
    el.client = { request, connected: true } as unknown as SupervisorNodeRegistryPanel["client"];
    const onChange = vi.fn();
    el.addEventListener("supervisor-tenant-change", onChange);
    await flush(el);
    const input = el.querySelector("input");
    expect(input).toBeTruthy();
    input!.value = "t1";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(el);
    const loadBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("加载绑定"),
    );
    loadBtn?.click();
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(request).toHaveBeenCalledWith("supervisor.node.bindings.list", { tenantId: "t1" });
    expect(el.textContent).toContain("seat-9");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows unavailable banner when supervisor disabled", async () => {
    const request = vi.fn(async () => {
      throw new GatewayRequestError({ code: "UNAVAILABLE", message: "off" });
    });
    const el = mount();
    el.client = { request, connected: true } as unknown as SupervisorNodeRegistryPanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("监督子系统未启用");
  });

  it("hides unbind in read-only mode", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.node.list") {
        return {
          nodes: [
            {
              nodeId: "mac-1",
              online: true,
              supportsSupervisorWorker: true,
              supervisorWorkerCommands: [],
              connectedAtMs: 0,
            },
          ],
        };
      }
      if (method === "supervisor.node.bindings.list") {
        return {
          bindings: [
            {
              tenantId: "t1",
              seatId: "seat-1",
              nodeId: "mac-1",
              updatedAt: "2026-06-18T00:00:00.000Z",
            },
          ],
        };
      }
      if (method === "supervisor.node.bindingRequest.list") {
        return { requests: [] };
      }
      return {};
    });
    const el = mount();
    el.tenantId = "t1";
    el.editable = false;
    el.client = { request, connected: true } as unknown as SupervisorNodeRegistryPanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("只读视图");
    expect(el.querySelector("button.btn--ghost")?.textContent).not.toContain("解除");
  });

  it("approves pending node binding requests", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.node.list") {
        return {
          nodes: [
            {
              nodeId: "mac-1",
              online: true,
              supportsSupervisorWorker: true,
              supervisorWorkerCommands: ["supervisor.worker.dispatch"],
              connectedAtMs: 0,
              displayName: "Daniel Mac",
            },
          ],
        };
      }
      if (method === "supervisor.node.bindings.list") {
        return { bindings: [] };
      }
      if (method === "supervisor.node.bindingRequest.list") {
        return {
          requests: [
            {
              requestId: "req-1",
              tenantId: "t1",
              seatId: "seat-1",
              userId: "u1",
              nodeId: "mac-1",
              nodeDisplayName: "Daniel Mac",
              status: "pending",
              requestedAt: "2026-06-27T00:00:00.000Z",
              updatedAt: "2026-06-27T00:00:00.000Z",
            },
          ],
        };
      }
      if (method === "supervisor.node.bindingRequest.resolve") {
        return { request: { requestId: "req-1", status: "approved" } };
      }
      return {};
    });
    const el = mount();
    el.tenantId = "t1";
    el.editable = true;
    el.client = { request, connected: true } as unknown as SupervisorNodeRegistryPanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("待确认申请");
    expect(el.textContent).toContain("seat-1");
    const approveBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("批准"),
    );
    approveBtn?.click();
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(request).toHaveBeenCalledWith("supervisor.node.bindingRequest.resolve", {
      requestId: "req-1",
      decision: "approved",
    });
  });
});
