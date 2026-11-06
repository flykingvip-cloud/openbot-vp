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
      readModel: { enterpriseDirectory: [] },
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
    expect(container.textContent).toContain("暂无跨租户历史聚合查询能力");
    const selector = workbench.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    expect(container.textContent).toContain("交互验收样例");
    expect(container.textContent).toContain("运行观测");
    expect(container.textContent).toContain("样例已启用");
    expect(container.textContent).not.toContain("暂无跨租户历史聚合查询能力");
    expect(container.querySelector("openbot-platform-monitor-task")).toBeNull();
    container.remove();
  });
});
