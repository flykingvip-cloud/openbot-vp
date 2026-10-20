// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "./employee-supervisor-center.ts";
import type { EmployeeSupervisorCenter } from "./employee-supervisor-center.ts";

function mount(
  props: NonNullable<EmployeeSupervisorCenter["supervisorProps"]>,
): EmployeeSupervisorCenter {
  const el = document.createElement("employee-supervisor-center");
  el.supervisorProps = props;
  document.body.appendChild(el);
  return el;
}

function mockSupervisorRequest(opts?: { nodeOnline?: boolean; codexAuth?: boolean }) {
  const nodeOnline = opts?.nodeOnline ?? false;
  const codexAuth = opts?.codexAuth ?? true;
  return vi.fn(async (method: string) => {
    if (method === "cliBackend.credential.scopedList") {
      return { credentials: [] };
    }
    if (method === "supervisor.node.list") {
      return {
        nodes: nodeOnline
          ? [
              {
                nodeId: "mac-1",
                online: true,
                supportsSupervisorWorker: true,
                supervisorWorkerCommands: [],
                connectedAtMs: 0,
              },
            ]
          : [],
      };
    }
    if (method === "supervisor.node.bindings.list") {
      return {
        bindings: nodeOnline
          ? [{ tenantId: "t1", seatId: "seat-1", nodeId: "mac-1", updatedAt: "" }]
          : [],
      };
    }
    if (method === "supervisor.node.bindingRequest.list") {
      return { requests: [] };
    }
    if (method === "supervisor.worker.health") {
      return {
        workers: [
          {
            backendId: "codex-cli",
            recommendedPolicy: "api_key",
            recommendedPlacement: "gateway",
            identity: { policy: "api_key", status: codexAuth ? "validated" : "missing" },
            placement: { available: true, executor: "gateway" },
            auth: {
              installed: true,
              authenticated: codexAuth,
              status: codexAuth ? "validated" : "missing",
              source: "probe",
            },
          },
        ],
      };
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
      return {
        workers: [{ backendId: "codex-cli", control: [], taskCapabilities: [], models: [] }],
      };
    }
    return {};
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flush(el: HTMLElement) {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await Promise.resolve();
}

describe("<employee-supervisor-center>", () => {
  it("shows create form when chain ready and canCreateTasks is true", async () => {
    const request = mockSupervisorRequest({ codexAuth: true });
    const el = mount({
      client: { request, connected: true } as unknown as NonNullable<
        EmployeeSupervisorCenter["supervisorProps"]
      >["client"],
      tenantId: "t1",
      userId: "u1",
      seatId: "seat-1",
      canCreateTasks: true,
      defaultRepoRoot: "/workspace/repo",
    });
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("可监督");
    expect(el.textContent).toContain("创建并启动");
    expect(el.querySelector(".employee-supervisor-center__bands")).toBeTruthy();
    expect(el.querySelector("#employee-supervisor-b1")).toBeTruthy();
    expect(el.querySelector("supervisor-seat-node-panel")).toBeTruthy();
    expect(el.textContent).toContain("本机 Node");
    expect(el.textContent).toContain("连接本机执行环境");
    expect(el.textContent).toContain("申请连接本机 Node");
    expect(el.textContent).not.toContain("立即绑定");
  });

  it("header CTA points to Node gap when not ready and does not open create", async () => {
    const request = mockSupervisorRequest({ nodeOnline: false, codexAuth: false });
    const el = mount({
      client: { request, connected: true } as unknown as NonNullable<
        EmployeeSupervisorCenter["supervisorProps"]
      >["client"],
      tenantId: "t1",
      userId: "u1",
      seatId: "seat-1",
      canCreateTasks: true,
    });
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("可建草稿但会立刻升级");
    expect(el.textContent).not.toContain("创建并启动");
    const cta = el.querySelector<HTMLElement>('[data-testid="supervisor-header-cta"]');
    expect(cta).toBeTruthy();
    expect(cta?.textContent).toMatch(/去上线 Node|去登录|去配置|去完成执行链/);
    cta?.click();
    await flush(el);
    expect(el.textContent).not.toContain("创建并启动");
  });

  it("auto-expands setup actions when checks are not all ready", async () => {
    const request = mockSupervisorRequest({ codexAuth: false });
    const el = mount({
      client: { request, connected: true } as unknown as NonNullable<
        EmployeeSupervisorCenter["supervisorProps"]
      >["client"],
      tenantId: "t1",
      userId: "u1",
      seatId: "seat-1",
      canCreateTasks: true,
    });
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    const setup = el.querySelector(".employee-supervisor-center__setup") as HTMLDetailsElement;
    expect(setup?.open).toBe(true);
    expect(el.textContent).toMatch(/\d+ \/ \d+ 就绪/);
  });

  it("shows pending seat offer accept action when seat is not active", async () => {
    const onAccept = vi.fn(async () => undefined);
    const el = mount({
      client: null,
      tenantId: "t1",
      userId: "u1",
      canCreateTasks: true,
      pendingSeatOffer: { offerId: "offer-1", seatTitle: "CEO" },
      onAcceptPendingSeatOffer: onAccept,
    });
    await flush(el);
    expect(el.textContent).toContain("待确认岗位");
    expect(el.textContent).toContain("CEO");
    expect(el.textContent).not.toContain("创建并启动");
    const acceptBtn = Array.from(el.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("确认岗位"),
    );
    acceptBtn?.click();
    expect(onAccept).toHaveBeenCalledWith("offer-1");
  });

  it("hides create form and guides to seat confirmation when no active seat", async () => {
    const onOpen = vi.fn();
    const el = mount({
      client: null,
      tenantId: "t1",
      userId: "u1",
      canCreateTasks: true,
      onOpenPersonalSettings: onOpen,
    });
    await flush(el);
    expect(el.textContent).toContain("尚未生效企业岗位");
    expect(el.textContent).not.toContain("创建并启动");
    const cta = Array.from(el.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("去确认岗位"),
    );
    cta?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("hides create form and shows permission hint without write scope", async () => {
    const request = mockSupervisorRequest({ codexAuth: true });
    const el = mount({
      client: { request, connected: true } as unknown as NonNullable<
        EmployeeSupervisorCenter["supervisorProps"]
      >["client"],
      tenantId: "t1",
      userId: "u1",
      seatId: "seat-1",
      canCreateTasks: false,
    });
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("无创建权限");
    expect(el.querySelector("#employee-supervisor-b1")).toBeTruthy();
    expect(el.textContent).not.toContain("创建并启动");
  });
});
