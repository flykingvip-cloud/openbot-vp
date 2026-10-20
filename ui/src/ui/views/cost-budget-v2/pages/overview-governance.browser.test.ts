// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import type { DashboardResponse } from "../../../capability/cost-budget-billing/index.ts";
import {
  __resetOperationsStoreForTest,
  __seedOperationsStoreForTest,
} from "../stores/operations-store.ts";
import {
  __resetSubscriptionStoreForTest,
  __seedSubscriptionStoreForTest,
} from "../stores/subscription-store.ts";
import { renderOverviewPage } from "./overview-page.ts";

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
  __resetOperationsStoreForTest();
  __resetSubscriptionStoreForTest();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("overview governance panel", () => {
  it("renders governance panel when dashboard reports over allocation", () => {
    __seedOperationsStoreForTest({
      dashboard: {
        subscribed: true,
        accruedCents: 0,
        seatCostCents: 0,
        usageCostCents: 0,
        extraCostCents: 0,
        predictedCents: null,
        budgetStatus: {
          level: "ok",
          monthlyLimitCents: 0,
          accruedCents: 0,
          predictedCents: null,
          alertThreshold: 0.8,
        },
        commercialGovernanceStatus: "over_allocated",
        overAllocation: {
          enterpriseId: "acme",
          subscriptionSnapshotId: "srs-1",
          status: "over_allocated",
          seatsOver: 0,
          botsOver: 2,
          seatProfilesOver: 0,
          privateModelsOver: 0,
          workflowsOver: 0,
          blockedActions: ["create_bot"],
          detectedAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
        consumptionForecast: {
          enterpriseId: "acme",
          cycleStart: "2026-06-01T00:00:00.000Z",
          cycleEnd: "2026-07-01T00:00:00.000Z",
          computedAt: "2026-06-23T00:00:00.000Z",
          forecastCostCents: null,
          forecastCostInsufficientData: true,
          creditsRemaining: 10,
          monthlyCredits: 100,
          creditsEtaDays: 3,
          creditsEtaInsufficientData: false,
          concurrencyUsed: 0,
          concurrencyLimit: 2,
          concurrencyPeakInCycle: 0,
          concurrencyRisk: "medium",
          concurrencyRiskMessage: "并发使用率偏高",
          marginCents: 0,
          tenantRevenueCents: 0,
          providerCostCents: 0,
          marginRatio: null,
          marginWarning: "none",
        },
        creditsReconciliation: {
          enterpriseId: "acme",
          cycleStart: "2026-06-01T00:00:00.000Z",
          cycleEnd: "2026-07-01T00:00:00.000Z",
          bucketGranted: 100,
          bucketConsumed: 90,
          bucketRemaining: 10,
          ledgerCreditsCharged: 90,
          ledgerCreditsV1: 60,
          ledgerCreditsV2: 30,
          aligned: true,
          driftCredits: 0,
          details: [],
        },
        snapshotType: "estimated",
        computedAt: "2026-06-23T00:00:00.000Z",
        stale: false,
      } satisfies DashboardResponse,
    });
    __seedSubscriptionStoreForTest({
      data: {
        subscription: { planId: "scale", status: "active" },
        planView: { id: "scale", name: "旗舰版", botQuota: 100 },
        pricingView: [],
        availablePlans: [],
      } as never,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderOverviewPage({
        client: { connected: true } as never,
        basePath: "",
        tenantId: "acme",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-governance-panel"]')).toBeTruthy();
    expect(container.textContent).toContain("治理状态与建议");
    expect(
      container.querySelector('[data-testid="cost-budget-governance-status-badge"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="cost-budget-governance-overallocation"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("禁止新建 AI 员工");
    expect(
      container.querySelector('[data-testid="cost-budget-governance-pricing-engine"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("AI 工作额度账本分列：v1 60 · v2 30");
  });

  it("renders AI governance projection when dashboard includes aiGovernance", () => {
    __seedOperationsStoreForTest({
      dashboard: {
        subscribed: true,
        accruedCents: 0,
        seatCostCents: 0,
        usageCostCents: 0,
        extraCostCents: 0,
        predictedCents: null,
        budgetStatus: {
          level: "ok",
          monthlyLimitCents: 0,
          accruedCents: 0,
          predictedCents: null,
          alertThreshold: 0.8,
        },
        commercialGovernanceStatus: "normal",
        aiGovernance: {
          enterpriseId: "acme",
          creditsV2Enabled: true,
          creditsV2RolloutStage: "full",
          creditsV2Effective: true,
          creditsPricingEngine: "v2",
          auditLogEnabled: true,
          mfaEnabled: false,
          ssoEnabled: false,
          vpcIsolationEnabled: false,
          tenantAllowPrivateModels: true,
          privateModelsCompliant: true,
          privateModelsOver: 0,
          privateModelStatus: "compliant",
          pendingApprovalsCount: 0,
          pendingApprovalsByCategory: {
            source_onboarding: 0,
            data_access: 0,
            capability_exposure: 0,
            identity_binding: 0,
            seat_capability_access: 0,
          },
          auditCoverageRatio: 1,
          auditCoverageGap: 0,
          complianceStatus: "attention",
          complianceIssues: ["建议启用 MFA 或 SSO 强化访问控制"],
        },
        snapshotType: "estimated",
        computedAt: "2026-06-23T00:00:00.000Z",
        stale: false,
      } satisfies DashboardResponse,
    });
    __seedSubscriptionStoreForTest({
      data: {
        subscription: { planId: "scale", status: "active" },
        planView: { id: "scale", name: "旗舰版", botQuota: 100 },
        pricingView: [],
        availablePlans: [],
      } as never,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderOverviewPage({
        client: { connected: true } as never,
        basePath: "",
        tenantId: "acme",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-governance-ai"]')).toBeTruthy();
    expect(container.textContent).toContain("建议启用 MFA 或 SSO 强化访问控制");
    expect(container.textContent).toContain("启用 MFA");
    expect(container.textContent).toContain("配置 SSO 强化访问控制");
  });

  it("renders aligned v1/v2 reconciliation split when governance is otherwise normal", () => {
    __seedOperationsStoreForTest({
      dashboard: {
        subscribed: true,
        accruedCents: 0,
        seatCostCents: 0,
        usageCostCents: 0,
        extraCostCents: 0,
        predictedCents: null,
        budgetStatus: {
          level: "ok",
          monthlyLimitCents: 0,
          accruedCents: 0,
          predictedCents: null,
          alertThreshold: 0.8,
        },
        commercialGovernanceStatus: "normal",
        creditsReconciliation: {
          enterpriseId: "acme",
          cycleStart: "2026-06-01T00:00:00.000Z",
          cycleEnd: "2026-07-01T00:00:00.000Z",
          bucketGranted: 100,
          bucketConsumed: 42,
          bucketRemaining: 58,
          ledgerCreditsCharged: 42,
          ledgerCreditsV1: 30,
          ledgerCreditsV2: 12,
          aligned: true,
          driftCredits: 0,
          details: [],
        },
        snapshotType: "estimated",
        computedAt: "2026-06-23T00:00:00.000Z",
        stale: false,
      } satisfies DashboardResponse,
    });
    __seedSubscriptionStoreForTest({
      data: {
        subscription: { planId: "scale", status: "active" },
        planView: { id: "scale", name: "旗舰版", botQuota: 100 },
        pricingView: [],
        availablePlans: [],
      } as never,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderOverviewPage({
        client: { connected: true } as never,
        basePath: "",
        tenantId: "acme",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-governance-panel"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="cost-budget-governance-pricing-engine"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("AI 工作额度账本分列：v1 30 · v2 12");
    expect(
      container.querySelector('[data-testid="cost-budget-governance-reconciliation-drift"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="cost-budget-governance-overallocation"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="cost-budget-governance-ai"]')).toBeTruthy();
  });

  it("renders runtime drift and pending approvals in governance panel", () => {
    __seedOperationsStoreForTest({
      dashboard: {
        subscribed: true,
        accruedCents: 0,
        seatCostCents: 0,
        usageCostCents: 0,
        extraCostCents: 0,
        predictedCents: null,
        budgetStatus: {
          level: "ok",
          monthlyLimitCents: 0,
          accruedCents: 0,
          predictedCents: null,
          alertThreshold: 0.8,
        },
        commercialGovernanceStatus: "normal",
        aiGovernance: {
          enterpriseId: "acme",
          creditsV2Enabled: true,
          creditsV2RolloutStage: "canary",
          creditsV2Effective: true,
          creditsPricingEngine: "v2",
          auditLogEnabled: true,
          mfaEnabled: true,
          ssoEnabled: false,
          vpcIsolationEnabled: false,
          tenantAllowPrivateModels: false,
          privateModelsCompliant: true,
          privateModelsOver: 0,
          privateModelStatus: "disabled",
          pendingApprovalsCount: 2,
          pendingApprovalsByCategory: {
            source_onboarding: 1,
            data_access: 1,
            capability_exposure: 0,
            identity_binding: 0,
            seat_capability_access: 0,
          },
          recentPendingApprovals: [
            {
              approvalId: "appr-1",
              category: "data_access",
              displayName: "CRM 只读访问",
              requestedAt: "2026-06-22T00:00:00.000Z",
            },
          ],
          auditCoverageRatio: 0.9,
          auditCoverageGap: 3,
          complianceStatus: "action_required",
          complianceIssues: ["待审批治理请求 2 条"],
        },
        commercialRuntimeDrift: {
          enterpriseId: "acme",
          cycleStart: "2026-06-01T00:00:00.000Z",
          cycleEnd: "2026-07-01T00:00:00.000Z",
          reconciliationAligned: false,
          reconciliationDriftCredits: 4,
          ledgerCreditsV1: 20,
          ledgerCreditsV2: 8,
          calibrationSampleCount: 12,
          calibrationMeanDeltaV2MinusV1: 1.25,
          calibrationMaxAbsDelta: 3,
        },
        snapshotType: "estimated",
        computedAt: "2026-06-23T00:00:00.000Z",
        stale: false,
      } satisfies DashboardResponse,
    });
    __seedSubscriptionStoreForTest({
      data: {
        subscription: { planId: "scale", status: "active" },
        planView: { id: "scale", name: "旗舰版", botQuota: 100 },
        pricingView: [],
        availablePlans: [],
      } as never,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderOverviewPage({
        client: { connected: true } as never,
        basePath: "",
        tenantId: "acme",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(
      container.querySelector('[data-testid="cost-budget-governance-runtime-drift"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("待审批治理请求 2 条");
    expect(container.textContent).toContain("计价监控对账偏差 4");
    expect(container.textContent).toContain("打开审批中心");
    expect(
      container.querySelector('[data-testid="cost-budget-governance-approvals-link"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="cost-budget-governance-approvals-inline"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="cost-budget-governance-approve-appr-1"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="cost-budget-governance-reject-appr-1"]'),
    ).toBeTruthy();
  });
});
