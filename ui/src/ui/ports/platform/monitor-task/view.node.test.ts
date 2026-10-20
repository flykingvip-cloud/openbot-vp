// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderEnterpriseDiagnosisSurface } from "../../enterprise/diagnosis/enterprise-diagnosis-surface.ts";
import type { DiagnosisViewModel } from "../../enterprise/diagnosis/enterprise-diagnosis-surface.ts";
import { monitorReportFromJob } from "./monitor-report.ts";
import { renderPlatformMonitorTask, type PlatformMonitorTaskState } from "./view.ts";

function state(over: Partial<PlatformMonitorTaskState> = {}): PlatformMonitorTaskState {
  return {
    tenants: [{ tenantId: "tenant-a1b2", label: "示例企业 A" }],
    tenantQuery: "",
    tenantMenuOpen: true,
    selectedTenantId: null,
    agents: [{ agentId: "agent-aa11", label: "客服助手 Alpha" }],
    groups: [{ groupId: "group-1", label: "值班组", roundId: "round-1" }],
    agentQuery: "",
    snapshot: null,
    runs: [],
    mode: "overview",
    draft: {
      cadence: "daily",
      scopeAll: true,
      scopeAgents: true,
      scopeGroups: false,
      agentIds: ["agent-aa11"],
      groupId: null,
      failureMinCount: null,
      efficiencyMaxTotalMs: null,
    },
    report: null,
    notice: null,
    permission: "allowed",
    busy: false,
    ...over,
  };
}

function mount(model: PlatformMonitorTaskState, handlers = {}) {
  const container = document.createElement("div");
  const defaults = {
    onTenantQuery: vi.fn(),
    onTenantMenu: vi.fn(),
    onSelectTenant: vi.fn(),
    onClearTenant: vi.fn(),
    onEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onSave: vi.fn(),
    onCadence: vi.fn(),
    onToggleScope: vi.fn(),
    onAgentQuery: vi.fn(),
    onToggleAgent: vi.fn(),
    onGroup: vi.fn(),
    onFailureThreshold: vi.fn(),
    onEfficiencyThreshold: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onRun: vi.fn(),
    onOpenReport: vi.fn(),
    onCloseReport: vi.fn(),
    onExport: vi.fn(),
    onCopyMachine: vi.fn(),
  };
  render(renderPlatformMonitorTask(model, { ...defaults, ...handlers }), container);
  return { container, handlers: { ...defaults, ...handlers } };
}

describe("platform monitor task view", () => {
  it("keeps write actions off until a tenant option is chosen", () => {
    const { container } = mount(state());
    expect(container.querySelector("[data-testid=monitor-tenant-search]")).toBeTruthy();
    expect(container.querySelector("input[name=tenantId]")).toBeNull();
    expect(
      (container.querySelector("[data-testid=monitor-edit]") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (container.querySelector("[data-testid=monitor-run]") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(container.textContent).not.toContain("岗位");
  });

  it("selects a tenant from the option list", () => {
    const onSelectTenant = vi.fn();
    const { container } = mount(state(), { onSelectTenant });
    const option = container.querySelector(
      "[data-testid=monitor-tenant-option]",
    ) as HTMLButtonElement;
    option.click();
    expect(onSelectTenant).toHaveBeenCalledWith("tenant-a1b2");
  });

  it("edits cadence with radios and agent checkboxes, not typed ids", () => {
    const { container } = mount(
      state({
        selectedTenantId: "tenant-a1b2",
        mode: "edit",
        snapshot: {
          cadence: "daily",
          paused: false,
          hasDefinition: true,
          agentIds: ["agent-aa11"],
          groupId: null,
          failureMinCount: null,
          efficiencyMaxTotalMs: null,
          runs: [],
        },
      }),
    );
    const radios = [...container.querySelectorAll("input[type=radio]")].map(
      (node) => (node as HTMLInputElement).value,
    );
    expect(radios).toEqual(["off", "daily", "tick"]);
    expect(container.querySelector("[data-testid=monitor-agent-option]")).toBeTruthy();
    expect(container.querySelector("[data-testid=monitor-group-select]")).toBeTruthy();
    expect(container.querySelector("input[type=text]")).toBeNull();
    expect(container.textContent).toContain("暂停 / 立即跑不改 cadence");
  });

  it("blocks 立即跑 while paused and keeps it distinct from 立即诊断", () => {
    const { container } = mount(
      state({
        selectedTenantId: "tenant-a1b2",
        snapshot: {
          cadence: "daily",
          paused: true,
          hasDefinition: true,
          agentIds: [],
          groupId: null,
          failureMinCount: null,
          efficiencyMaxTotalMs: null,
          runs: [],
        },
      }),
    );
    const run = container.querySelector("[data-testid=monitor-run]") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(run.title).toBe("任务已暂停");
    expect(container.textContent).toContain("无法创建 Run：任务已暂停");
    expect(container.querySelector("[data-testid=monitor-resume]")).toBeTruthy();
    expect(container.textContent).toContain("立即诊断 ≠ 立即跑");
    const labels = [...container.querySelectorAll("button")].map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).not.toContain("立即诊断");
  });

  it("exports the full report as the primary action", () => {
    const onExport = vi.fn();
    const report = monitorReportFromJob({
      tenantLabel: "示例企业 A",
      cadence: "daily",
      trigger: "daily",
      roundId: null,
      window: { start: "2026-10-10T00:00:00.000Z", end: "2026-10-11T00:00:00.000Z" },
      report: {
        tenantId: "tenant-a1b2",
        runId: "run-0a3f",
        filter: { failure: null, efficiency: null },
        matched: [],
      },
    });
    const { container } = mount(
      state({ mode: "report", report, selectedTenantId: "tenant-a1b2" }),
      {
        onExport,
      },
    );
    (container.querySelector("[data-testid=monitor-export-md]") as HTMLButtonElement).click();
    (container.querySelector("[data-testid=monitor-export-yaml]") as HTMLButtonElement).click();
    expect(onExport).toHaveBeenNthCalledWith(1, "md");
    expect(onExport).toHaveBeenNthCalledWith(2, "yaml");
    expect(container.querySelector("[data-testid=monitor-copy]")).toBeTruthy();
    expect(container.querySelector("[data-testid=monitor-confirm]")).toBeNull();
    expect(container.querySelector("[data-testid=monitor-repair]")).toBeNull();
    expect(container.textContent).toContain("中文摘要");
    expect(container.textContent).toContain("修复指引");
    expect(container.textContent).not.toContain("岗位");
  });
});

describe("enterprise has no monitoring-task partition", () => {
  it("keeps one-shot diagnose and does not render the platform task", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseDiagnosisSurface(enterpriseModel(), {
        onDiagnoseNow: () => undefined,
        targets: [],
      }),
      container,
    );
    expect(container.querySelector("[data-testid=platform-monitor-task]")).toBeNull();
    expect(container.textContent).not.toContain("立即跑");
    expect(container.querySelector("[data-testid=diagnosis-run-now]")).toBeTruthy();
  });
});

function enterpriseModel(): DiagnosisViewModel {
  return {
    role: "enterprise",
    tenantScope: "tenant-a",
    redactionProfile: "user",
    permissionState: "allowed",
    health: { tone: "ok", label: "正常", openP0: 0, openP1: 0, inconclusive: 0, expired: 0 },
    cases: [],
    drilldown: [],
    timeline: { events: [] },
    trend: {
      window: { from: "2026-10-10T00:00:00.000Z", to: "2026-10-11T00:00:00.000Z" },
      completeness: "empty",
      buckets: [],
      missingBuckets: [],
    },
    graph: { nodes: [], edges: [] },
    authorizations: { rows: [], pendingApprovals: [] },
    remediations: [],
    conversationEntries: [],
    reportExport: { action: "export_existing_report", exporter: "none" },
  };
}
