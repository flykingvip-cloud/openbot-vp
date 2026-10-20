// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  renderPlatformDiagnosisSurface,
  type DiagnosisViewModel,
} from "./platform-diagnosis-surface.ts";

function baseModel(over: Partial<DiagnosisViewModel> = {}): DiagnosisViewModel {
  return {
    role: "platform",
    tenantScope: null,
    redactionProfile: "administrator",
    permissionState: "allowed",
    health: {
      tone: "degraded",
      label: "存在 P0",
      openP0: 1,
      openP1: 0,
      inconclusive: 0,
      expired: 0,
    },
    cases: [{ caseId: "case-a", severity: "P0", status: "open", tenantId: "tenant-fixture-a" }],
    drilldown: [
      { layer: "enterprise", id: "tenant-fixture-a", status: "open", tenantId: "tenant-fixture-a" },
      { layer: "agent", id: "agent-a", status: "observed", tenantId: "tenant-fixture-a" },
    ],
    timeline: {
      events: [
        {
          kind: "signal",
          timestamp: "2026-09-03T01:00:00.000Z",
          ref: { id: "sig-a", type: "signal" },
        },
      ],
    },
    trend: {
      window: { from: "2026-09-03T00:00:00.000Z", to: "2026-09-03T04:00:00.000Z" },
      completeness: "partial",
      buckets: [
        { at: "2026-09-03T00:00:00.000Z", sampleCount: 0, present: false },
        { at: "2026-09-03T01:00:00.000Z", sampleCount: 1, present: true },
      ],
      missingBuckets: ["2026-09-03T00:00:00.000Z"],
    },
    graph: {
      nodes: [{ id: "sig-a", kind: "signal", label: "signal" }],
      edges: [],
    },
    authorizations: {
      rows: [],
      pendingApprovals: [
        {
          grantId: "grant-pending",
          targetTenant: "tenant-fixture-a",
          targetPrincipal: "user-a",
          dataScope: ["finding_ref"],
          actions: ["inspect"],
          expiresAt: "2026-09-04T00:00:00.000Z",
          risk: "medium",
        },
      ],
    },
    remediations: [{ remediationId: "rem-a", status: "BLOCKED", verdict: "inconclusive" }],
    conversationEntries: [
      {
        signalId: "sig-a",
        caseId: "case-a",
        targetRef: { targetType: "session", targetId: "session-a", tenantId: "tenant-fixture-a" },
        tenantId: "tenant-fixture-a",
      },
    ],
    reportExport: {
      action: "export_existing_report",
      exporter: "exportCompositeDiagnosisReportJson",
      reportId: "cdr-fixture",
    },
    ...over,
  };
}

describe("platform diagnosis surface", () => {
  it("renders empty, inconclusive, expired, and load-error without calling them healthy", () => {
    for (const tone of ["empty", "inconclusive", "expired", "error"] as const) {
      const container = document.createElement("div");
      render(
        renderPlatformDiagnosisSurface(
          baseModel({
            health: {
              tone,
              label: tone === "error" ? "加载失败" : "暂无数据",
              openP0: 0,
              openP1: 0,
              inconclusive: 0,
              expired: 0,
            },
            permissionState:
              tone === "error" ? "unavailable" : tone === "empty" ? "empty" : "allowed",
            loadError: tone === "error" ? "reader_unavailable" : undefined,
          }),
        ),
        container,
      );
      expect(container.textContent).not.toMatch(/健康|已解决/);
      expect(container.querySelector("[data-health-tone]")?.getAttribute("data-health-tone")).toBe(
        tone,
      );
    }
  });

  it("opens Da Bai with references only and refreshes P6/P7 on approve", () => {
    const container = document.createElement("div");
    const onOpenConversation = vi.fn();
    const onAuthorizationDecision = vi.fn();
    const onExportReport = vi.fn();
    render(
      renderPlatformDiagnosisSurface(baseModel(), {
        onOpenConversation,
        onAuthorizationDecision,
        onExportReport,
      }),
      container,
    );
    expect(
      container.querySelector("[data-testid=open-daibai]")?.getAttribute("data-signal-id"),
    ).toBe("sig-a");
    expect(container.textContent).not.toMatch(/prompt|toolResult|payload|messageBody/);
    (container.querySelector("[data-testid=open-daibai]") as HTMLButtonElement).click();
    expect(onOpenConversation).toHaveBeenCalledWith({
      signalId: "sig-a",
      caseId: "case-a",
      targetRef: { targetType: "session", targetId: "session-a", tenantId: "tenant-fixture-a" },
      tenantId: "tenant-fixture-a",
    });
    (container.querySelector("[data-testid=approve-grant]") as HTMLButtonElement).click();
    expect(onAuthorizationDecision).toHaveBeenCalledWith({
      grantId: "grant-pending",
      decision: "approve",
      refresh: "p6_p7",
    });
    (container.querySelector("[data-testid=export-report]") as HTMLButtonElement).click();
    expect(onExportReport).toHaveBeenCalledWith({
      reportId: "cdr-fixture",
      redactionProfile: "administrator",
    });
    expect(container.querySelector("[data-testid=platform-diagnosis-contract-gap]")).toBeNull();
  });

  it("shows production freshness and audit without calling incomplete data normal", () => {
    const container = document.createElement("div");
    render(
      renderPlatformDiagnosisSurface(
        baseModel({
          production: {
            apiLoadState: "stale",
            permissionState: "allowed",
            auditState: "missing",
            freshness: {
              observedAt: "2026-09-03T01:00:00.000Z",
              maxAgeMs: 900000,
              stale: true,
              completeness: "partial",
            },
          },
        }),
      ),
      container,
    );
    expect(container.querySelector("[data-testid=platform-production-status]")).toBeTruthy();
    expect(container.querySelector("[data-testid=production-unhealthy]")).toBeTruthy();
    expect(container.textContent).not.toMatch(/健康|已解决/);
  });

  it("disables approval, conversation, and export until a handler is wired", () => {
    const container = document.createElement("div");
    render(renderPlatformDiagnosisSurface(baseModel()), container);
    for (const testId of ["approve-grant", "deny-grant", "open-daibai", "export-report"]) {
      const button = container.querySelector(`[data-testid=${testId}]`) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toContain("尚未接入");
    }
    expect(
      container.querySelector("[data-testid=platform-diagnosis-contract-gap]")?.textContent,
    ).toContain("没有对应网关方法");
  });
});
