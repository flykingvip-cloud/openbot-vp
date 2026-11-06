import { render } from "lit";
import { describe, expect, it } from "vitest";
import { readRuntimeObservations, recordRuntimeObservation } from "../runtime-observation.ts";
import { renderObservationWorkbench, type OpenBotObservationWorkbench } from "./workbench.ts";

describe("observation workbench interaction", () => {
  it("starts from the original host projection, then explicitly enters samples and evidence", async () => {
    const host = {};
    expect(readRuntimeObservations(host, "agent:one:main").reasons).toContain("not_observed");
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "enterprise",
        tenantId: "demo",
        sessionKey: "agent:one:main",
        connected: true,
        observationHost: host,
      }),
      container,
    );
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    expect(panel.querySelector(".obs-reasons")?.textContent).toContain(
      "还没有严格匹配当前会话的事件",
    );
    panel.querySelector<HTMLButtonElement>("button.obs-link")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-empty")?.textContent).toContain("当前会话还没有观测事件");
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(3);
    expect(panel.querySelector('[data-observation-source="sample"]')).not.toBeNull();
    panel.querySelector<HTMLButtonElement>("[data-run-id=sample-partial]")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("未供给 / 不推断");
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("工具结束 ≠ 任务成功");
    expect(panel.querySelectorAll(".obs-drawer input, .obs-drawer textarea, form")).toHaveLength(0);
    container.remove();
  });
});

describe("observation live projection", () => {
  it("reads the existing host and preserves source runs, missing evidence, and gaps", async () => {
    const host = {};
    for (const sourceRunId of ["engine_B", "engine_A"]) {
      for (const seq of [1, 4]) {
        recordRuntimeObservation(
          host,
          "agent:one:main",
          {
            runId: "client_01",
            sourceRunId,
            sessionKey: "agent:one:main",
            seq,
            ts: 100 + seq,
            stream: "tool",
            data: { phase: "end", toolCallId: "tool_01", args: { private: true } },
          },
          120 + seq,
        );
      }
    }
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "enterprise",
        tenantId: "demo",
        sessionKey: "agent:one:main",
        connected: true,
        observationHost: host,
      }),
      container,
    );
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    panel.querySelector<HTMLButtonElement>("button.obs-link")!.click();
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(2);
    expect(panel.textContent).toContain("engine_A");
    expect(panel.textContent).not.toContain("private");
    panel.querySelector<HTMLButtonElement>("[data-run-id='client_01@engine_A']")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("工具结束 ≠ 任务成功");
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain(
      "成本未知 · 未伪造为零或把周期账单摊到单任务",
    );
    expect(panel.querySelector(".obs-drawer-reasons")?.textContent).toContain("断序或乱序");
    container.remove();
  });
});
