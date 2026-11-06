import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { OpenBotObservationWorkbench } from "../../../observation/workbench.ts";
import type { PlatformPortRenderModel } from "../view-types.ts";
import { renderPlatformPortShell } from "./platform-shell.ts";

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
    expect(container.textContent).toContain("近 7 天跨租户视图来自企业目录摘要");
    expect(container.textContent).toContain("壳层目录企业");
    expect(container.textContent).toContain("9");
    const selector = workbench.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(container.textContent).toContain("交互验收样例");
    expect(container.textContent).toContain("运行观测");
    expect(container.textContent).toContain("样例已启用");
    expect(container.textContent).toContain("物业示例（样例）");
    expect(container.textContent).not.toContain("近 7 天跨租户视图来自企业目录摘要");
    expect(container.querySelector("openbot-platform-monitor-task")).toBeNull();
    expect(
      workbench.querySelectorAll('[role="tablist"][aria-label="观测视图"] button'),
    ).toHaveLength(3);
    container.remove();
  });
});
