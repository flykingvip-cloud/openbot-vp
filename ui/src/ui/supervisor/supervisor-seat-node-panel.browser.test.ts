// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import type { SupervisorSeatNodePanel } from "./supervisor-seat-node-panel.ts";
import "./supervisor-seat-node-panel.ts";

function mount(): SupervisorSeatNodePanel {
  const el = document.createElement("supervisor-seat-node-panel");
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

describe("<supervisor-seat-node-panel>", () => {
  it("shows unavailable checklist when supervisor is disabled", async () => {
    const request = vi.fn(async () => {
      throw new GatewayRequestError({ code: "UNAVAILABLE", message: "supervisor is not enabled" });
    });
    const el = mount();
    el.tenantId = "t1";
    el.seatId = "seat-1";
    el.client = { request } as unknown as SupervisorSeatNodePanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("开发监督子系统已启用");
    expect(el.textContent).toContain("OPENBOT_SUPERVISOR_ENABLED");
  });

  it("binds seat to selected node when editable", async () => {
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
            },
          ],
        };
      }
      if (method === "supervisor.node.bindings.list") {
        return { bindings: [] };
      }
      if (method === "supervisor.node.bindingRequest.list") {
        return { requests: [] };
      }
      if (method === "supervisor.worker.health") {
        return {
          workers: [
            {
              backendId: "cursor-cli",
              recommendedPolicy: "local_ide_login",
              recommendedPlacement: "node_agent",
              identity: { policy: "local_ide_login", status: "configured" },
              placement: { available: false, executor: "node_agent", reason: "no binding" },
              auth: { installed: true, authenticated: false, status: "missing", source: "probe" },
            },
          ],
        };
      }
      if (method === "supervisor.node.bind") {
        return {
          binding: {
            tenantId: "t1",
            seatId: "seat-1",
            nodeId: "mac-1",
            updatedAt: new Date().toISOString(),
          },
        };
      }
      return {};
    });
    const el = mount();
    el.tenantId = "t1";
    el.seatId = "seat-1";
    el.editable = true;
    el.client = { request } as unknown as SupervisorSeatNodePanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("Cursor CLI");
    expect(el.textContent).toContain("尚未绑定本机 Node");
    const bindBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("绑定 Node"),
    );
    expect(bindBtn).toBeTruthy();
    bindBtn?.click();
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(request).toHaveBeenCalledWith(
      "supervisor.node.bind",
      expect.objectContaining({ tenantId: "t1", seatId: "seat-1", nodeId: "mac-1" }),
    );
    expect(el.textContent).toContain("已绑定 Node");
  });

  it("lets employee request node connection without handling tenant details", async () => {
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
            },
          ],
        };
      }
      if (method === "supervisor.node.bindings.list") {
        return { bindings: [] };
      }
      if (method === "supervisor.node.bindingRequest.list") {
        return { requests: [] };
      }
      if (method === "supervisor.worker.health") {
        return {
          workers: [
            {
              backendId: "cursor-cli",
              recommendedPolicy: "local_ide_login",
              recommendedPlacement: "node_agent",
              identity: { policy: "local_ide_login", status: "configured" },
              placement: {
                available: false,
                executor: "node_agent",
                reason: 'Node Agent placement is not available for worker "cursor-cli"',
              },
              auth: { installed: true, authenticated: false, status: "missing", source: "probe" },
            },
          ],
        };
      }
      if (method === "supervisor.node.bindingRequest.create") {
        return {
          request: {
            requestId: "req-1",
            tenantId: "t1",
            seatId: "seat-1",
            userId: "u1",
            nodeId: "mac-1",
            status: "pending",
            requestedAt: "2026-06-27T00:00:00.000Z",
            updatedAt: "2026-06-27T00:00:00.000Z",
          },
        };
      }
      return {};
    });
    const el = mount();
    el.tenantId = "t1";
    el.tenantLabel = "UPBEYOND";
    el.seatId = "seat-1";
    el.seatLabel = "研发负责人";
    el.userId = "u1";
    el.editable = false;
    el.client = { request } as unknown as SupervisorSeatNodePanel["client"];
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("连接本机执行环境");
    expect(el.textContent).toContain("申请连接本机 Node");
    expect(el.textContent).toContain("Cursor CLI");
    expect(el.textContent).toContain("Cursor CLI 暂不可在本机 Node 执行");
    expect(el.textContent).toContain("当前企业");
    expect(el.textContent).toContain("UPBEYOND");
    expect(el.textContent).toContain("当前岗位");
    expect(el.textContent).toContain("研发负责人");
    expect(el.textContent).not.toContain("开发监督子系统已启用");
    expect(el.textContent).not.toContain("立即绑定");
    const requestBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("申请连接本机 Node"),
    );
    requestBtn?.click();
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(request).toHaveBeenCalledWith(
      "supervisor.node.bindingRequest.create",
      expect.objectContaining({ tenantId: "t1", seatId: "seat-1", userId: "u1", nodeId: "mac-1" }),
    );
    expect(el.textContent).toContain("等待企业管理员确认");
  });
});
