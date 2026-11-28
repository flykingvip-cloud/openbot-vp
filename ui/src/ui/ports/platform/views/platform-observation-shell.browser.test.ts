import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { OpenBotObservationWorkbench } from "../../../observation/workbench.ts";
import type { PlatformPortRenderModel } from "../view-types.ts";
import { renderPlatformPortShell } from "./platform-shell.ts";

function directoryEntry(
  tenantId: string,
  label: string,
  tenantGrant?: "granted" | "none" | "unknown",
) {
  return {
    tenantId,
    label,
    ...(tenantGrant ? { tenantGrant } : {}),
    status: "paid" as const,
    plan: "标准",
    seatQuota: 10,
    seatUsed: 2,
    seatsRemaining: 8,
    billingStatus: "ok",
    createdSource: "platform-created" as const,
  };
}

async function mountObservation(options: {
  scopes?: readonly string[] | null;
  canManagePlatform?: boolean;
  directory: readonly ReturnType<typeof directoryEntry>[];
}) {
  const container = document.createElement("div");
  document.body.append(container);
  const model = {
    state: {
      tab: "platformObservation",
      basePath: "",
      client: null,
      connected: true,
      platformAuthState: {
        session: { provider: "trusted-proxy", user: "reader", scopes: options.scopes ?? undefined },
        ...(options.canManagePlatform ? { canManagePlatform: true } : {}),
      },
    },
    subnavProps: {
      tabs: [],
      activeTab: "platformObservation",
      basePath: "",
      onOpenConsoleTab: () => undefined,
    },
    channelsProps: {},
    readModel: { enterpriseDirectory: options.directory },
    pageViewModels: {},
    surfaceActions: {},
    authPanelProps: { session: { provider: "trusted-proxy", user: "admin" } },
    observationHost: {},
  } as unknown as PlatformPortRenderModel;
  render(renderPlatformPortShell(model), container);
  await customElements.whenDefined("openbot-observation-workbench");
  const workbench = container.querySelector(
    "openbot-observation-workbench",
  ) as OpenBotObservationWorkbench;
  await workbench.updateComplete;
  return { container, workbench };
}

describe("platform observation shell", () => {
  it("renders live limited metadata and explicit samples without a tenant history fabrication", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const model = {
      state: { tab: "platformObservation", basePath: "", client: null, connected: true },
      subnavProps: {
        tabs: [],
        activeTab: "platformObservation",
        basePath: "",
        onOpenConsoleTab: () => undefined,
      },
      channelsProps: {},
      readModel: {
        enterpriseDirectory: [
          {
            tenantId: "tenant-shell",
            label: "壳层目录企业",
            status: "paid",
            plan: "标准",
            seatQuota: 10,
            seatUsed: 2,
            seatsRemaining: 8,
            billingStatus: "ok",
            createdSource: "platform-created",
            usageSummary: {
              calls7d: 9,
              cost7d: 1.25,
              updatedAt: Date.parse("2026-11-05T00:00:00.000Z"),
            },
            healthSummary: { label: "目录健康", tone: "ok", successRate: 0.95 },
          },
        ],
      },
      pageViewModels: {},
      surfaceActions: {},
      authPanelProps: { session: { provider: "trusted-proxy", user: "admin" } },
      observationHost: {},
    } as unknown as PlatformPortRenderModel;
    render(renderPlatformPortShell(model), container);
    expect(container.querySelector(".platform-surface")).not.toBeNull();
    await customElements.whenDefined("openbot-observation-workbench");
    const workbench = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await workbench.updateComplete;
    expect(container.textContent).toContain("精确任务查询");
    expect(container.textContent).toContain("壳层目录企业");
    expect(container.textContent).toContain("平台观测");
    expect(container.textContent).toContain("平台健康与覆盖");
    expect(container.textContent).toContain("精确任务查询");
    expect(container.textContent).toContain("租户隔离与授权");
    expect(container.querySelector(".obs-pulse-grid")).toBeNull();
    workbench.setSource("sample");
    await workbench.updateComplete;
    expect(container.textContent).toContain("交互验收样例");
    expect(container.textContent).toContain("平台观测");
    expect(container.textContent).toContain("样例验收已启用");
    expect(container.textContent).toContain("物业示例（样例）");
    expect(container.textContent).not.toContain("近 7 天跨租户视图来自企业目录摘要");
    expect(container.querySelector("openbot-platform-monitor-task")).toBeNull();
    expect(workbench.querySelector('[role="tablist"][aria-label="观测视图"]')).toBeNull();
    container.remove();
  });

  it("passes server-confirmed tenant grants into the workbench and does not invent a denial from unknown or omission", async () => {
    const { container, workbench } = await mountObservation({
      scopes: ["operator.read"],
      directory: [
        directoryEntry("tenant-granted", "已授权企业", "granted"),
        directoryEntry("tenant-none", "无授权企业", "none"),
        directoryEntry("tenant-unknown", "未确认企业", "unknown"),
        directoryEntry("tenant-omitted", "未返回授权企业"),
      ],
    });
    expect(workbench.authorized).toBe(true);
    expect(workbench.tenantGrants).toEqual({
      "tenant-granted": "granted",
      "tenant-none": "none",
      "tenant-unknown": "unknown",
      "tenant-omitted": "unknown",
    });

    const tenant = workbench.querySelector<HTMLSelectElement>("select[aria-label=租户筛选]")!;
    tenant.value = "tenant-granted";
    tenant.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')).toBeNull();
    expect(workbench.textContent).not.toContain("当前租户授权尚未确认");
    // Platform overview exposes precise authorized queries, not the enterprise analysis tabs.
    expect(workbench.querySelector(".obs-query-submit")).not.toBeNull();
    expect(workbench.textContent).toContain("精确任务查询");

    tenant.value = "tenant-none";
    tenant.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前租户筛选无授权",
    );
    expect(workbench.querySelectorAll(".obs-run")).toHaveLength(0);

    tenant.value = "tenant-unknown";
    tenant.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前租户授权尚未确认",
    );
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')?.textContent).not.toContain(
      "无授权",
    );
    expect(workbench.querySelectorAll(".obs-run")).toHaveLength(0);

    tenant.value = "tenant-omitted";
    tenant.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前租户授权尚未确认",
    );
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')?.textContent).not.toContain(
      "无授权",
    );
    expect(workbench.querySelectorAll(".obs-run")).toHaveLength(0);
    container.remove();
  });

  it("lets an operator.read-only platform session filter a granted tenant and leaves tenantFilter=all unaffected", async () => {
    const { container, workbench } = await mountObservation({
      scopes: ["operator.read"],
      directory: [
        directoryEntry("tenant-granted", "只读已授权企业", "granted"),
        directoryEntry("tenant-unknown", "未确认企业", "unknown"),
      ],
    });
    expect(workbench.authorized).toBe(true);
    expect(workbench.scopes).toEqual(["operator.read"]);
    expect(workbench.tenantGrants).toEqual({
      "tenant-granted": "granted",
      "tenant-unknown": "unknown",
    });

    const tenant = workbench.querySelector<HTMLSelectElement>("select[aria-label=租户筛选]")!;
    expect(tenant.value).toBe("all");
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')).toBeNull();
    expect(workbench.textContent).not.toContain("当前租户授权尚未确认");
    tenant.value = "tenant-granted";
    tenant.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')).toBeNull();
    expect(workbench.textContent).not.toContain("当前租户授权尚未确认");
    expect(workbench.textContent).not.toContain("当前租户筛选无授权");
    // Platform overview exposes precise authorized queries, not the enterprise analysis tabs.
    expect(workbench.querySelector(".obs-query-submit")).not.toBeNull();
    expect(workbench.textContent).toContain("精确任务查询");

    tenant.value = "tenant-unknown";
    tenant.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前租户授权尚未确认",
    );
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')?.textContent).not.toContain(
      "无授权",
    );

    tenant.value = "all";
    tenant.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(workbench.querySelector('[data-testid="obs-access-notice"]')).toBeNull();
    expect(workbench.textContent).not.toContain("当前租户授权尚未确认");
    expect(workbench.textContent).not.toContain("当前租户筛选无授权");
    container.remove();
  });
});
