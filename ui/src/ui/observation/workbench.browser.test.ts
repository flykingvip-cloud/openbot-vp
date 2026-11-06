import { render } from "lit";
import { describe, expect, it } from "vitest";
import {
  clearRuntimeObservations,
  readRuntimeObservations,
  recordRuntimeObservation,
} from "../runtime-observation.ts";
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
    expect(panel.querySelectorAll('[role="tablist"][aria-label="观测视图"] button')).toHaveLength(
      3,
    );
    expect(panel.querySelector(".obs-empty")?.textContent).toContain("当前会话还没有观测事件");
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(3);
    expect(panel.querySelector('[data-observation-source="sample"]')).not.toBeNull();
    panel.querySelector<HTMLButtonElement>("[data-run-id=sample-partial]")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain(
      "成本未知 · 未伪造为零或把周期账单摊到单任务",
    );
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
    panel.sessionKey = "agent:other:main";
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.textContent).not.toContain("engine_A");
    container.remove();
  });
});

describe("platform tenant compare filters", () => {
  it("wires directory summaries, sample switch, tenant filter, and keeps three tabs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "platform",
        tenantId: null,
        sessionKey: null,
        connected: true,
        observationHost: {},
        enterpriseDirectory: [
          {
            tenantId: "tenant-a",
            label: "华东正式企业",
            status: "paid",
            plan: "标准",
            healthSummary: {
              label: "运行平稳",
              tone: "ok",
              successRate: 0.98,
              updatedAt: Date.parse("2026-11-05T02:00:00.000Z"),
            },
            usageSummary: {
              calls7d: 42,
              cost7d: 3.5,
              updatedAt: Date.parse("2026-11-05T02:00:00.000Z"),
            },
          },
          {
            tenantId: "tenant-b",
            label: "西南试用企业",
            status: "trial",
            healthSummary: { label: "待观察", tone: "neutral" },
          },
        ],
      }),
      container,
    );
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;

    expect(panel.querySelectorAll('[role="tablist"][aria-label="观测视图"] button')).toHaveLength(
      3,
    );
    expect(panel.querySelector('[data-testid="obs-tenant-compare"]')?.textContent).toContain(
      "华东正式企业",
    );
    expect(panel.querySelector('[data-tenant-id="tenant-a"]')?.textContent).toContain("42");
    expect(panel.querySelector('[data-tenant-id="tenant-a"]')?.textContent).toContain("3.50");
    expect(panel.querySelector('[data-tenant-id="tenant-b"]')?.textContent).toContain("未知");
    expect(panel.querySelector(".obs-event-scope")?.textContent).toContain(
      "下方运行证据仍是当前连接窗口",
    );
    expect(panel.querySelector('[data-tenant-id="tenant-b"]')?.textContent).not.toMatch(
      /近 7 天调用[\s\S]*\b0\b/,
    );

    const sample = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    sample.value = "sample";
    sample.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.textContent).toContain("物业示例（样例）");
    expect(panel.textContent).toContain("华北示例（样例）");
    expect(panel.querySelectorAll(".obs-tenant-card")).toHaveLength(2);

    const tenant = panel.querySelector<HTMLSelectElement>("select[aria-label=租户筛选]")!;
    tenant.value = "sample-tenant-property";
    tenant.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-tenant-card")).toHaveLength(1);
    expect(panel.querySelector("[data-tenant-filter]")?.getAttribute("data-tenant-filter")).toBe(
      "sample-tenant-property",
    );

    panel.querySelector<HTMLButtonElement>('[data-tenant-id="sample-tenant-property"]')!.click();
    await panel.updateComplete;
    expect(panel.querySelector('[aria-selected="true"]')?.textContent).toContain("态势总览");
    expect(panel.querySelectorAll(".obs-run").length).toBeGreaterThan(0);
    expect(panel.textContent).toContain("物业示例（样例）");
    expect(panel.textContent).not.toContain("华北示例（样例） ·");

    const tabs = [
      ...panel.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="观测视图"] button',
      ),
    ];
    tabs[2].click();
    await panel.updateComplete;
    expect(panel.textContent).toContain("从发现到验证");
    expect(panel.querySelector(".obs-filters")).not.toBeNull();
    expect(panel.querySelector(".obs-filters")?.textContent).toContain("物业示例（样例）");
    tabs[0].click();
    await panel.updateComplete;
    expect(panel.querySelectorAll('[role="tablist"][aria-label="观测视图"] button')).toHaveLength(
      3,
    );
    container.remove();
  });

  it("shows empty directory state without fabricating live tenant metrics", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "platform",
        tenantId: null,
        sessionKey: null,
        connected: true,
        observationHost: {},
        enterpriseDirectory: [],
      }),
      container,
    );
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    expect(panel.querySelector('[data-testid="obs-tenant-compare"]')?.textContent).toContain(
      "暂无企业目录摘要",
    );
    expect(panel.querySelectorAll(".obs-tenant-card")).toHaveLength(0);
    expect(panel.textContent).toContain("暂无跨租户历史聚合查询能力");
    container.remove();
  });

  it("updates only on real events, pauses presentation, and drills a gap into the same run", async () => {
    const host = {};
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "enterprise",
        tenantId: "t1",
        sessionKey: "agent:main",
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
    expect(panel.querySelectorAll(".obs-sparkline")).toHaveLength(0);
    expect(panel.querySelector(".obs-realtime-head")?.textContent).toContain("从本次连接开始");
    for (const [seq, stream, phase] of [
      [1, "lifecycle", "start"],
      [2, "tool", "end"],
      [3, "lifecycle", "end"],
    ] as const) {
      recordRuntimeObservation(
        host,
        "agent:main",
        {
          runId: "client_dynamic",
          sourceRunId: "engine_dynamic",
          sessionKey: "agent:main",
          seq,
          ts: seq * 20,
          stream,
          data: { phase },
        },
        seq * 100,
      );
    }
    await panel.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await panel.updateComplete;
    expect(readRuntimeObservations(host, "agent:main").events.length).toBe(3);
    expect(panel.querySelector(".obs-stream-foot")?.textContent).toContain("1 次数据变化");
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(1);
    panel.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    await panel.updateComplete;
    const frozen =
      panel.querySelector(".obs-run-improvement")?.textContent ??
      panel.querySelector(".obs-run")?.textContent;
    recordRuntimeObservation(
      host,
      "agent:main",
      {
        runId: "client_next",
        sourceRunId: "engine_next",
        sessionKey: "agent:main",
        seq: 1,
        ts: 80,
        stream: "lifecycle",
        data: { phase: "start" },
      },
      400,
    );
    await panel.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await panel.updateComplete;
    expect(panel.querySelector(".obs-run")?.textContent).toBe(frozen);
    expect(readRuntimeObservations(host, "agent:main").events.length).toBe(4);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await panel.updateComplete;
    expect(panel.querySelector(".obs-stream-foot")?.textContent).toContain("后台已收到更新");
    panel.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(2);
    panel.querySelector<HTMLButtonElement>('[data-metric="sequence_or_link_gaps"]')!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-improvement")?.textContent).toContain("client_next");
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    panel.querySelector<HTMLButtonElement>(".obs-improvement .obs-link")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("client_next");
    panel.querySelector<HTMLButtonElement>('[aria-label="关闭证据"]')!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.querySelector(".obs-improvement")).not.toBeNull();
    clearRuntimeObservations(host);
    container.remove();
  });

  it("shows unknown live metrics for an enterprise with no tenant mapping", async () => {
    const container = document.createElement("div");
    render(
      renderObservationWorkbench({
        role: "platform",
        tenantId: null,
        sessionKey: "agent:main",
        connected: true,
        observationHost: {},
        enterpriseDirectory: [{ tenantId: "t1", label: "企业一", status: "active" }],
      }),
      container,
    );
    document.body.append(container);
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    const select = panel.querySelector<HTMLSelectElement>('[aria-label="租户筛选"]')!;
    select.value = "t1";
    select.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(
      [...panel.querySelectorAll(".obs-pulse-card strong")].every(
        (el) => el.textContent?.includes("未知") || el.textContent?.includes("—"),
      ),
    ).toBe(true);
    expect(panel.querySelector(".obs-empty")?.textContent).toContain("所选企业暂无已映射运行事件");
    container.remove();
  });
});
