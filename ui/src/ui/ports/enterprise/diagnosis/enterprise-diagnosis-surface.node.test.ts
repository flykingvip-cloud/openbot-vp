// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../../i18n/index.ts";
import {
  renderEnterpriseDiagnosisSurface,
  type DiagnosisViewModel,
} from "./enterprise-diagnosis-surface.ts";

function baseModel(over: Partial<DiagnosisViewModel> = {}): DiagnosisViewModel {
  return {
    role: "enterprise",
    tenantScope: "tenant-fixture-a",
    redactionProfile: "administrator",
    permissionState: "allowed",
    health: { tone: "watch", label: "存在 P1", openP0: 0, openP1: 1, inconclusive: 0, expired: 0 },
    cases: [{ caseId: "case-a", severity: "P1", status: "open", tenantId: "tenant-fixture-a" }],
    drilldown: [
      { layer: "agent", id: "agent-a", status: "observed", tenantId: "tenant-fixture-a" },
      { layer: "skill", id: "skill-a", status: "observed", tenantId: "tenant-fixture-a" },
      { layer: "tool", id: "tool-a", status: "observed", tenantId: "tenant-fixture-a" },
    ],
    timeline: {
      events: [
        {
          kind: "signal",
          timestamp: "2026-09-03T01:00:00.000Z",
          ref: { id: "sig-a", type: "signal" },
        },
        {
          kind: "case",
          timestamp: "2026-09-03T01:08:00.000Z",
          ref: { id: "case-a", type: "case" },
        },
      ],
    },
    trend: {
      window: { from: "2026-09-03T00:00:00.000Z", to: "2026-09-03T04:00:00.000Z" },
      completeness: "partial",
      buckets: [{ at: "2026-09-03T00:00:00.000Z", sampleCount: 0, present: false }],
      missingBuckets: ["2026-09-03T00:00:00.000Z"],
    },
    graph: { nodes: [], edges: [] },
    authorizations: {
      rows: [
        {
          grantId: "grant-a",
          status: "APPROVED",
          targetTenant: "tenant-fixture-a",
          dataScope: ["finding_ref"],
          actions: ["inspect"],
          expiresAt: "2026-09-04T00:00:00.000Z",
          risk: "medium",
        },
      ],
      pendingApprovals: [],
    },
    remediations: [{ remediationId: "rem-a", status: "PREVIEWED" }],
    conversationEntries: [{ signalId: "sig-a", caseId: "case-a", tenantId: "tenant-fixture-a" }],
    reportExport: {
      action: "export_existing_report",
      exporter: "exportCompositeDiagnosisReportJson",
    },
    ...over,
  };
}

describe("enterprise diagnosis surface", () => {
  it("keeps tenant scope visible and never renders missing data as resolved", () => {
    const container = document.createElement("div");
    render(renderEnterpriseDiagnosisSurface(baseModel()), container);
    expect(container.querySelector("[data-tenant-scope]")?.getAttribute("data-tenant-scope")).toBe(
      "tenant-fixture-a",
    );
    expect(container.querySelector("[data-testid=trend-missing]")).toBeTruthy();
    expect(container.textContent).not.toMatch(/健康|已解决/);
    expect(container.textContent).not.toMatch(/prompt|toolResult|payload|messageBody/);
  });

  it("sends only conversation references and refreshes existing authorization state", () => {
    const container = document.createElement("div");
    const onOpenConversation = vi.fn();
    const onAuthorizationDecision = vi.fn();
    render(
      renderEnterpriseDiagnosisSurface(
        baseModel({
          authorizations: {
            rows: [],
            pendingApprovals: [
              {
                grantId: "grant-pending",
                targetTenant: "tenant-fixture-a",
                targetPrincipal: "user-a",
                dataScope: ["report_summary"],
                actions: ["inspect"],
                expiresAt: "2026-09-04T00:00:00.000Z",
                risk: "low",
              },
            ],
          },
        }),
        { onOpenConversation, onAuthorizationDecision },
      ),
      container,
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    (container.querySelector("[data-testid=open-daibai]") as HTMLButtonElement).click();
    expect(onOpenConversation).toHaveBeenCalledWith({
      signalId: "sig-a",
      caseId: "case-a",
      tenantId: "tenant-fixture-a",
    });
    expect(onOpenConversation.mock.calls[0]?.[0]).not.toHaveProperty("evidenceIds");
    (container.querySelector("[data-testid=deny-grant]") as HTMLButtonElement).click();
    expect(onAuthorizationDecision).toHaveBeenCalledWith({
      grantId: "grant-pending",
      decision: "deny",
      refresh: "p6_p7",
    });
  });

  it("keeps stale production status from looking normal", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseDiagnosisSurface(
        baseModel({
          production: {
            apiLoadState: "unavailable",
            permissionState: "empty",
            auditState: "unavailable",
            freshness: {
              observedAt: null,
              maxAgeMs: 900000,
              stale: true,
              completeness: "unavailable",
            },
          },
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid=enterprise-production-status]")).toBeTruthy();
    expect(container.querySelector("[data-testid=production-unhealthy]")).toBeTruthy();
    expect(container.textContent).not.toMatch(/健康|已解决/);
    const openDaibai = container.querySelector(
      "[data-testid=open-daibai-standalone]",
    ) as HTMLButtonElement;
    expect(openDaibai.disabled).toBe(true);
    expect(openDaibai.getAttribute("title")).toContain("尚未接入");
  });

  it("renders a flat first-level page with designed empty states", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseDiagnosisSurface(
        baseModel({
          loadError: "gateway_unavailable",
          health: {
            tone: "empty",
            label: "暂无数据",
            openP0: 0,
            openP1: 0,
            inconclusive: 0,
            expired: 0,
          },
          drilldown: [],
          timeline: { events: [] },
          authorizations: { rows: [], pendingApprovals: [] },
          remediations: [],
          conversationEntries: [],
          production: {
            apiLoadState: "unavailable",
            permissionState: "unavailable",
            auditState: "unavailable",
            freshness: {
              observedAt: null,
              maxAgeMs: 0,
              stale: true,
              completeness: "unavailable",
            },
          },
        }),
      ),
      container,
    );
    const root = container.querySelector("[data-testid=enterprise-diagnosis]");
    expect(root?.classList.contains("enterprise-diagnosis")).toBe(true);
    expect(root?.classList.contains("card")).toBe(false);
    expect(container.querySelector(".enterprise-org-ws--flat")).toBeTruthy();
    expect(container.querySelectorAll(".card").length).toBe(0);
    expect(container.querySelectorAll(".enterprise-org-ws__kv").length).toBe(0);
    expect(
      [...container.querySelectorAll(".enterprise-diagnosis__group-title")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["观察", "处置", "证据"]);
    expect(container.querySelector("[data-testid=status-layers-empty]")).toBeTruthy();
    expect(container.querySelector("[data-testid=timeline-empty]")).toBeTruthy();
    expect(container.querySelector("[data-testid=diagnosis-load-error]")?.textContent).toContain(
      "网关不可用",
    );
    expect(container.textContent).toContain(t("tabs.enterpriseDiagnosis"));
    const openDaibai = container.querySelector(
      "[data-testid=open-daibai-standalone]",
    ) as HTMLButtonElement;
    expect(openDaibai.disabled).toBe(true);
    expect(openDaibai.getAttribute("title")).toContain("尚未对企业开放");
    expect(container.textContent).toContain("还没有可观察的信号或事件。");
    expect(container.textContent).toContain("当前没有待审批或修复项。");
    expect(container.textContent).not.toMatch(/健康|已解决/);
  });

  it("hides the module header when embedded under the shared workbench", () => {
    const container = document.createElement("div");
    render(renderEnterpriseDiagnosisSurface(baseModel(), { embedded: true }), container);
    expect(container.textContent).not.toContain(t("tabs.enterpriseDiagnosis"));
    expect(container.querySelector(".enterprise-module-header")).toBeNull();
    expect(container.querySelector("[data-testid=open-daibai-standalone]")).toBeNull();
    expect(container.querySelector("[data-testid=diagnosis-task-outcome]")).toBeTruthy();
    container.remove();
  });

  it("renders a diagnose target picker and asks for a choice before running", () => {
    const container = document.createElement("div");
    const onDiagnoseNow = vi.fn();
    const onSelectTarget = vi.fn();
    render(
      renderEnterpriseDiagnosisSurface(baseModel(), {
        onDiagnoseNow,
        onSelectTarget,
        targets: [
          {
            id: "agent:main",
            kind: "agent",
            label: "大白管家",
            agentId: "main",
            sessionKey: "agent:main:main",
            steward: true,
          },
          {
            id: "group:alpha",
            kind: "group",
            label: "产品协作",
            agentId: "main",
            sessionKey: "agent:main:space:alpha",
            steward: true,
          },
        ],
        selectedTargetId: "agent:main",
      }),
      container,
    );
    const select = container.querySelector(
      "[data-testid=diagnosis-target-select]",
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect([...select.options].map((node) => node.value)).toContain("all");
    expect(container.querySelector("[data-testid=diagnosis-window-select]")).toBeTruthy();
    expect(
      container.querySelector("[data-testid=diagnosis-mode-select]")?.textContent,
    ).not.toContain("QUICK");
    expect(container.querySelector("[data-testid=diagnosis-cadence-select]")).toBeTruthy();
    expect(container.textContent).not.toMatch(/一年|1y|QUICK/);
    expect([...select.querySelectorAll("optgroup")].map((node) => node.label)).toEqual([
      "数字人",
      "协作小组",
    ]);
    expect(container.querySelector("[data-testid=diagnosis-target-hint]")?.textContent).toContain(
      "正在诊断大白管家自己的运行记录",
    );
    (container.querySelector("[data-testid=diagnosis-run-now]") as HTMLButtonElement).click();
    expect(onDiagnoseNow).toHaveBeenCalledTimes(1);
    select.value = "group:alpha";
    select.dispatchEvent(new Event("change"));
    expect(onSelectTarget).toHaveBeenCalledWith("group:alpha");
  });

  it("keeps 打开大白诊断 visible but disabled when delivery is closed", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseDiagnosisSurface(baseModel({ conversationEntries: [] }), {
        daibaiDeliveryEnabled: false,
      }),
      container,
    );
    const button = container.querySelector(
      "[data-testid=open-daibai-standalone]",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.classList.contains("enterprise-diagnosis__sr-only")).toBe(false);
    expect(button.getAttribute("title")).toContain("尚未对企业开放");
  });

  it("surfaces a diagnose-now result instead of looking idle", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseDiagnosisSurface(
        baseModel({ health: { ...baseModel().health, tone: "empty" } }),
        {
          lastDiagnose: { kind: "no_session" },
        },
      ),
      container,
    );
    expect(container.querySelector("[data-testid=diagnosis-run-note]")?.textContent).toContain(
      "没有可观察的运行记录",
    );
    expect(container.textContent).toContain("没有可诊断的会话");
    expect(container.textContent).not.toMatch(/健康|已解决/);
  });

  it("renders the diagnose report as a flat article, not a nested pre dump", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseDiagnosisSurface(baseModel(), {
        lastDiagnose: {
          kind: "done",
          reportText: [
            "【诊断报告】",
            "",
            "一、结论与窗口",
            "对象：市场助手",
            "运行结论：证据不足",
            "综述：运行面证据不足；身份或主人字段未齐。",
            "",
            "三、特征属性",
            "工作区：可读",
            "IDENTITY 未确认（缺 name）",
          ].join("\n"),
        },
      }),
      container,
    );
    expect(container.querySelector("[data-testid=diagnosis-report-article]")).toBeTruthy();
    expect(
      container.querySelector(".enterprise-diagnosis__banner [data-testid=diagnosis-report-text]"),
    ).toBeNull();
    expect(container.querySelector("[data-testid=diagnosis-report-text]")?.textContent).toContain(
      "对象：市场助手",
    );
    expect(container.querySelector(".enterprise-diagnosis__article-heading")?.textContent).toBe(
      "一、结论与窗口",
    );
    expect(container.textContent).toContain("工作区");
    expect(container.textContent).toContain("可读");
  });

  it("keeps open disabled when the row has no signal or case", () => {
    const container = document.createElement("div");
    const onOpenConversation = vi.fn();
    render(
      renderEnterpriseDiagnosisSurface(
        baseModel({
          conversationEntries: [
            {
              targetRef: { targetType: "agent", targetId: "bot-a", tenantId: "tenant-fixture-a" },
              tenantId: "tenant-fixture-a",
            },
          ],
          authorizations: { rows: [], pendingApprovals: [] },
        }),
        { onOpenConversation, onAuthorizationDecision: vi.fn() },
      ),
      container,
    );
    const open = container.querySelector("[data-testid=open-daibai]") as HTMLButtonElement;
    const standalone = container.querySelector(
      "[data-testid=open-daibai-standalone]",
    ) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.getAttribute("title")).toContain("没有信号或案例编号");
    expect(standalone.disabled).toBe(true);
    expect(container.textContent).toContain("没有待审批的授权，不能批准或拒绝。");
    open.click();
    expect(onOpenConversation).not.toHaveBeenCalled();
  });
});
