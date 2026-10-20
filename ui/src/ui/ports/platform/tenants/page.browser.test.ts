// @vitest-environment jsdom

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformSurfaceProps } from "../shared/surface.ts";
import { platformTenantObjectKey, PLATFORM_TENANTS_HASH_PREFIX } from "./adapter.ts";
import { __resetPlatformTenantsForTest, renderPlatformTenantsSurface } from "./page.ts";

const TENANT_ID = "workspace-6-44ccf420";
const OBJECT_KEY = platformTenantObjectKey({ tenantId: TENANT_ID });

function createProps(): PlatformSurfaceProps {
  return {
    tab: "platformTenants",
    basePath: "",
    readModel: {
      currentTenantId: TENANT_ID,
      currentTenantLabel: "蔚东智创",
      knownTenantIds: [TENANT_ID],
      tenantDirectory: [{ tenantId: TENANT_ID, label: "蔚东智创 (宁夏) 数字科技有限公司" }],
      enterpriseDirectory: [
        {
          tenantId: TENANT_ID,
          label: "蔚东智创 (宁夏) 数字科技有限公司",
          status: "expired",
          plan: "trial",
          billingStatus: "试用到期",
          createdSource: "self-serve",
          seatQuota: 5,
          seatUsed: 1,
          seatsRemaining: 4,
          trialEndsAt: "2026-07-30T10:24:00.000Z",
          contact: {
            contactName: "张三",
            contactEmail: "zhangsan@example.com",
            status: "pending_activation",
          },
        },
      ],
      agentDirectory: [],
      modelDirectory: [],
      gatewayCatalogModels: [],
      taskPlanDirectory: [],
      routingPolicyDirectory: [],
      gatewayCatalogCount: 0,
      defaultModelPrimary: null,
      defaultModelFallbacks: [],
      defaultImageModelPrimary: null,
      allowlistedModelRefs: [],
      allowlistEntries: [],
      aliasCount: 0,
      providerHealthDirectory: [],
      agentCount: 0,
      featureMethodCount: 0,
      channelCount: 0,
      channelIds: [],
      accountCount: 0,
      connectedAccountCount: 0,
      presenceCount: 0,
      runtimeHosts: [],
      sessionsCount: 0,
      totalTokens: 0,
      totalCost: 0,
      missingCostEntries: 0,
      currentUsageOverview: {
        sessionCount: 0,
        totalTokens: 0,
        totalCost: 0,
        totalMessages: 0,
        errorCount: 0,
        errorRate: 0,
        avgLatencyMs: null,
        peakErrorDayLabel: null,
        topModelLabel: null,
        topAgentId: null,
        activeAgentCount: 0,
        activeChannelCount: 0,
        dailyCalls: [],
        dailyCost: [],
        updatedAt: null,
      },
      modelMode: null,
      configuredProviderCount: 0,
      providerIds: [],
      configuredModelCount: 0,
      configuredModelIds: [],
      installedCapabilityCount: 0,
      attentionItems: [],
      currentVersion: "2026.3.9",
      latestVersion: "2026.3.9",
      hasUpdateAvailable: false,
      cronEnabled: null,
      cronNextAt: null,
      operatorUser: "ops@example.com",
      operatorRole: "super_admin",
      latestInvite: null,
      runtimeAgents: [],
      runtimeBindings: [],
      runtimeTelemetry: [],
      runtimeGovernanceIssues: [],
    } as never,
    channelsProps: {} as never,
    authPanelProps: {
      state: {
        canManagePlatform: true,
        platformEnterprises: [
          {
            id: TENANT_ID,
            name: "蔚东智创 (宁夏) 数字科技有限公司",
            seatQuota: 5,
          },
        ],
        trialApplications: [],
      },
      busy: false,
      error: null,
      notice: null,
    } as never,
    actions: {
      tenants: {
        onRefresh: () => undefined,
        onRefreshDirectory: () => undefined,
        onRefreshCoverage: () => undefined,
        onUpdateTrialInstance: vi.fn(async () => true),
        onUpdateEnterpriseAdmin: vi.fn(async () => true),
        onResendEnterpriseAdminActivation: vi.fn(async () => true),
      },
    } as never,
  };
}

function mount(hash: string) {
  const container = document.createElement("div");
  document.body.append(container);
  window.history.replaceState(
    {},
    "",
    `/platform/tenants${PLATFORM_TENANTS_HASH_PREFIX}${encodeURIComponent(OBJECT_KEY)}:${hash}`,
  );
  const props = createProps();
  const doRender = () => render(renderPlatformTenantsSurface(props), container);
  // Module-level navigation calls requestOpenBotAppRerender(); bridge it for jsdom.
  const appHost = document.createElement("openbot-app") as HTMLElement & {
    requestUpdate: () => void;
  };
  appHost.requestUpdate = () => doRender();
  document.body.append(appHost);
  doRender();
  return { container, doRender, appHost, props };
}

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  __resetPlatformTenantsForTest();
});

describe("renderPlatformTenantsSurface detail interactions", () => {
  it("composes a quiet left-right board without header action clutter", () => {
    const { container } = mount("overview");
    const text = container.textContent ?? "";
    expect(text).toContain("蔚东智创 (宁夏) 数字科技有限公司");
    expect(text).toContain("基本信息");
    expect(container.querySelector('[data-testid="tenant-detail-split"]')).toBeTruthy();
    expect(container.querySelector(".platform-tenants__detail-page--composed")).toBeTruthy();
    expect(container.querySelector(".platform-tenants__detail-board")).toBeTruthy();
    expect(container.querySelector(".platform-tenants__detail-tabs--line")).toBeTruthy();
    expect(container.querySelector(".platform-tenants__detail-actions-row")).toBeNull();
    expect(container.querySelector('[data-testid="tenant-goto-billing"]')).toBeNull();
    expect(text).not.toContain("租户详情");
    expect(text).not.toContain("租户已到期");
    expect(text).not.toContain("需要处理");
    expect(text).not.toContain("调整套餐");
    expect(text).not.toContain("查看风险");
    expect(text).not.toContain("配置策略");
    const statusRow =
      container.querySelector(".platform-tenants__detail-status-row")?.textContent ?? "";
    expect(statusRow).not.toContain("截止");
    expect(container.querySelector(".platform-tenants__detail-section-actions")).toBeNull();
  });

  it("switches detail tabs without synthetic popstate refresh", () => {
    const popSpy = vi.fn();
    window.addEventListener("popstate", popSpy);
    const isActive = (root: ParentNode, id: string) =>
      root
        .querySelector(`[data-testid="tenant-detail-tab-${id}"]`)
        ?.classList.contains("is-active") ?? false;
    try {
      const { container } = mount("billing");
      expect(container.querySelector('[data-testid="tenant-detail-tab-billing"]')).toBeTruthy();
      expect(isActive(container, "billing")).toBe(true);

      container
        .querySelector<HTMLButtonElement>('[data-testid="tenant-detail-tab-overview"]')
        ?.click();
      expect(popSpy).not.toHaveBeenCalled();
      expect(window.location.hash).toContain(":overview");
      expect(isActive(container, "overview")).toBe(true);

      container
        .querySelector<HTMLButtonElement>('[data-testid="tenant-detail-tab-usage"]')
        ?.click();
      expect(window.location.hash).toContain(":usage");
      expect(isActive(container, "usage")).toBe(true);
    } finally {
      window.removeEventListener("popstate", popSpy);
    }
  });

  it("opens the extend-trial dialog from the inline trial-end action", () => {
    const { container } = mount("overview");
    const extend = container.querySelector<HTMLButtonElement>(
      '[data-testid="tenant-extend-trial"]',
    );
    expect(extend).toBeTruthy();
    expect(extend?.classList.contains("platform-tenants__inline-action")).toBe(true);
    expect(container.querySelector('[data-testid="tenant-extend-dialog"]')).toBeNull();
    extend?.click();
    expect(container.querySelector('[data-testid="tenant-extend-dialog"]')).toBeTruthy();
    expect(container.textContent).toContain("选择延期时长");
    expect(container.textContent).toContain("1 周");
    expect(container.textContent).toContain("2 周");
    expect(container.textContent).toContain("4 周");
  });

  it("opens seat settings from the identity seat row and saves a custom quota", async () => {
    const { container, props } = mount("overview");
    const settings = container.querySelector<HTMLButtonElement>(
      '[data-testid="tenant-seat-settings"]',
    );
    expect(settings).toBeTruthy();
    expect(settings?.textContent?.trim()).toBe("席位设置");
    expect(container.querySelector('[data-testid="tenant-seat-settings-dialog"]')).toBeNull();
    settings?.click();
    expect(container.querySelector('[data-testid="tenant-seat-settings-dialog"]')).toBeTruthy();
    expect(container.textContent).toContain("试用席位上限");
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="tenant-seat-count-input"]',
    );
    expect(input?.value).toBe("5");
    input!.value = "500";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[data-testid="tenant-seat-save"]')?.click();
    const update = props.actions.tenants.onUpdateTrialInstance as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        enterpriseId: TENANT_ID,
        seatCount: 500,
      });
    });
  });

  it("shows admin contact and opens the edit-admin dialog", () => {
    const { container } = mount("overview");
    const text = container.textContent ?? "";
    expect(text).toContain("张三");
    expect(text).toContain("zhangsan@example.com");
    const edit = container.querySelector<HTMLButtonElement>('[data-testid="tenant-edit-admin"]');
    expect(edit).toBeTruthy();
    expect(edit?.textContent?.trim()).toBe("编辑管理员");
    expect(container.querySelector('[data-testid="tenant-admin-contact-dialog"]')).toBeNull();
    edit?.click();
    expect(container.querySelector('[data-testid="tenant-admin-contact-dialog"]')).toBeTruthy();
    expect(container.textContent).toContain("维护企业管理员联系人");
    expect(container.querySelector('[data-testid="tenant-admin-save"]')).toBeTruthy();
  });

  it("invokes resend activation from the edit-admin dialog", async () => {
    const { container, props } = mount("overview");
    const resend = props.actions.tenants.onResendEnterpriseAdminActivation as ReturnType<
      typeof vi.fn
    >;
    container.querySelector<HTMLButtonElement>('[data-testid="tenant-edit-admin"]')?.click();
    const resendBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="tenant-admin-resend"]',
    );
    expect(resendBtn).toBeTruthy();
    expect(resendBtn?.disabled).toBe(false);
    resendBtn?.click();
    await vi.waitFor(() => {
      expect(resend).toHaveBeenCalledWith({ enterpriseId: TENANT_ID });
    });
  });
});

describe("tenant directory actions", () => {
  it("exposes one create-tenant entry and a disabled suspend control", () => {
    window.history.replaceState({}, "", "/platform/tenants");
    const container = document.createElement("div");
    document.body.append(container);
    render(renderPlatformTenantsSurface(createProps()), container);
    const createLinks = [...container.querySelectorAll("a")].filter((anchor) =>
      anchor.textContent?.includes("创建租户"),
    );
    expect(createLinks).toHaveLength(1);
    expect(container.textContent).not.toContain("更多创建模式");
    expect(container.textContent).toContain("租户目录");
  });

  it("keeps suspend/resume disabled instead of linking to system settings", () => {
    const { container } = mount("risks");
    const pause = container.querySelector<HTMLButtonElement>('[data-testid="tenant-pause"]');
    const resume = container.querySelector<HTMLButtonElement>('[data-testid="tenant-resume"]');
    expect(pause?.disabled).toBe(true);
    expect(resume?.disabled).toBe(true);
    expect(pause?.textContent?.trim()).toBe("暂停");
    expect(resume?.textContent?.trim()).toBe("恢复");
    expect(pause?.title).toContain("网关未连接");
    expect(container.querySelector('a[href*="system-settings"]')).toBeNull();
    expect(container.textContent).toContain("高级控制");
  });

  it("pauses a tenant only when the returned status is suspended", async () => {
    const request = vi.fn(async () => ({
      tenantId: TENANT_ID,
      status: "suspended",
      previousStatus: "active",
    }));
    const { container, props } = mount("risks");
    props.client = { connected: true, request } as never;
    props.scopes = ["operator.admin"];
    render(renderPlatformTenantsSurface(props), container);
    container.querySelector<HTMLButtonElement>('[data-testid="tenant-pause"]')?.click();
    const reason = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="tenant-lifecycle-reason"]',
    );
    expect(reason).toBeTruthy();
    reason!.value = "billing hold";
    reason!.dispatchEvent(new Event("input", { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[data-testid="tenant-lifecycle-confirm"]')?.click();
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("platform.tenant.pause", {
        tenantId: TENANT_ID,
        reason: "billing hold",
      });
      expect(container.textContent).toContain("状态已记为 suspended");
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not treat a mismatched resume payload as success", async () => {
    const request = vi.fn(async () => ({
      tenantId: TENANT_ID,
      status: "suspended",
      previousStatus: "suspended",
    }));
    const { container, props } = mount("risks");
    props.client = { connected: true, request } as never;
    props.scopes = ["operator.admin"];
    render(renderPlatformTenantsSurface(props), container);
    container.querySelector<HTMLButtonElement>('[data-testid="tenant-resume"]')?.click();
    const reason = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="tenant-lifecycle-reason"]',
    );
    reason!.value = "lift hold";
    reason!.dispatchEvent(new Event("input", { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[data-testid="tenant-lifecycle-confirm"]')?.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("未记为成功");
    });
    expect(container.textContent).not.toContain("状态已记为 active");
  });
});

describe("trial application detail navigation", () => {
  it("opens pending trial application detail from row click", () => {
    const appId = "e09c0e88-aed1-48c8-afd3-aaaaaaaaaaaa";
    const container = document.createElement("div");
    document.body.append(container);
    window.history.replaceState({}, "", "/platform/tenants");
    const props = createProps();
    (props.authPanelProps as { state: Record<string, unknown> }).state.trialApplications = [
      {
        id: appId,
        companyName: "中国建筑技术集团",
        contactName: "李宏波",
        workEmail: "lihongbo@bjzjjf.com",
        expectedUsers: 20,
        useCase: "办公协作",
        needsDemo: false,
        status: "pending",
        reviewReasons: ["mid_market_team"],
        createdAt: "2026-08-06T03:31:00.000Z",
        updatedAt: "2026-08-06T03:31:00.000Z",
      },
    ];
    const doRender = () => render(renderPlatformTenantsSurface(props), container);
    const appHost = document.createElement("openbot-app") as HTMLElement & {
      requestUpdate: () => void;
    };
    appHost.requestUpdate = () => doRender();
    document.body.append(appHost);
    doRender();
    expect(container.textContent).toContain("中国建筑技术集团");
    expect(container.textContent).toContain("待审批");
    const row = Array.from(
      container.querySelectorAll<HTMLElement>(".platform-tenants__table-row"),
    ).find((el) => el.textContent?.includes("中国建筑技术集团"));
    expect(row).toBeTruthy();
    row!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(window.location.hash).toContain(encodeURIComponent(`app:${appId}`));
    expect(container.textContent).toContain("批准申请");
    expect(container.textContent).toContain("拒绝申请");
    expect(container.textContent).toContain("申请信息");
  });
});
