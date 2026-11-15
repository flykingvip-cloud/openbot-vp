import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
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
        authorized: true,
        observationHost: host,
      }),
      container,
    );
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    expect(panel.querySelector(".obs-reasons")).toBeNull();
    expect(panel.querySelector(".obs-empty")?.textContent).toContain(
      "没有严格匹配的事件时，不借用其他会话数据",
    );
    expect(panel.querySelectorAll('[role="tablist"][aria-label="观测视图"] button')).toHaveLength(
      3,
    );
    expect(panel.querySelector(".obs-empty")?.textContent).toContain("当前筛选下没有可观测事件");
    expect(panel.querySelector(".obs-header h2")?.textContent).toBe("智能诊断");
    expect(panel.querySelector(".obs-header .obs-eyebrow")).toBeNull();
    expect(panel.querySelector(".obs-header p")).toBeNull();
    expect(panel.textContent).not.toContain("态势总览、运行分析与治理验证共用同一授权投影");
    expect(panel.textContent).not.toContain("任务质量进化中心");
    expect(panel.querySelector('[aria-label="连接工作台筛选"]')).not.toBeNull();
    expect(panel.querySelector(".obs-wb-filters__head")).toBeNull();
    expect(panel.querySelector('[aria-label="连接工作台筛选"]')?.textContent).not.toContain(
      "连接工作台筛选",
    );
    expect(panel.querySelector('[data-action="pause"]')?.textContent).toContain("暂停刷新");
    expect(panel.textContent).not.toContain("当前企业 · 个人与共享终态分开");
    expect(panel.textContent).not.toContain("当前连接观察片段");
    expect(panel.textContent).not.toContain("四个筛选项为独立维度");
    expect(panel.textContent).not.toContain("筛选上下文：");
    expect(panel.textContent).not.toContain("下方运行证据仍是当前连接窗口");
    expect(panel.querySelector('[aria-label="观测对象筛选"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="会话筛选"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="运行类型筛选"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="需要关注的运行"]')?.textContent).toContain(
      "需要关注的运行",
    );
    expect(panel.querySelector('[aria-label="观测闭环说明"]')?.textContent).toContain(
      "观测闭环说明",
    );
    expect([...panel.querySelectorAll(".obs-pulse-card")].map((card) => card.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("活跃运行"),
        expect.stringContaining("事件计数"),
        expect.stringContaining("执行生命周期完成率"),
        expect.stringContaining("延迟 P50"),
        expect.stringContaining("延迟 P95"),
        expect.stringContaining("工具调用"),
      ]),
    );
    const issueBoard = panel.querySelector('[aria-label="需要关注的运行"]');
    const metrics = panel.querySelector(".obs-metrics-block");
    expect(
      issueBoard &&
        metrics &&
        issueBoard.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("资格未供给");
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("improvementEligible：false");
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("运行标识与状态");
    expect(panel.querySelector('[aria-label="四层证据"]')?.textContent).toContain("未供给");
    expect(panel.querySelector('[aria-label="四层证据"]')?.textContent).not.toContain("已验证");
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
        authorized: true,
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
  it("renders the R5 platform first screen with health, exact query, and grant table", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "platform",
        tenantId: null,
        sessionKey: null,
        connected: true,
        authorized: true,
        tenantGrants: {
          "tenant-a": "granted",
          "tenant-b": "unknown",
        },
        observationHost: {},
        enterpriseDirectory: [
          {
            tenantId: "tenant-a",
            label: "华东正式企业",
            status: "paid",
            plan: "标准",
            tenantGrant: "granted",
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

    expect(panel.querySelector('[data-testid="obs-platform-health"]')?.textContent).toContain(
      "平台健康与覆盖",
    );
    expect(
      panel.querySelector('[data-testid="obs-health-关联覆盖率"] .obs-cap-val')?.textContent,
    ).toBe("未知");
    expect(panel.querySelector('[data-testid="obs-health-关联覆盖率"] .obs-coverage-meter')).not.toBeNull();
    expect(panel.querySelector('[data-testid="obs-health-关联覆盖率"] .obs-coverage-meter__fill')).toBeNull();
    expect(panel.querySelector('[data-testid="obs-platform-health"]')?.textContent).not.toContain(
      "覆盖率必须带分子分母",
    );
    expect(panel.querySelector('[data-testid="obs-precise-query"]')?.textContent).not.toContain(
      "必须输入精确的任务或运行标识",
    );
    expect(panel.querySelector('[data-testid="obs-precise-query"]')?.textContent).not.toContain(
      "不支持模糊检索",
    );
    expect(panel.querySelector('[data-testid="obs-precise-query"]')?.textContent).not.toContain(
      "尚未执行精确查询",
    );
    expect(panel.querySelector('[data-testid="obs-tenant-compare"]')?.textContent).not.toContain(
      "租户之间隔离；无授权租户不可查询",
    );
    expect(panel.querySelector("select[aria-label=观测数据源]")).not.toBeNull();
    expect(
      panel.querySelector('[data-testid="obs-health-心跳时效"] .obs-cap-val')?.textContent,
    ).toBe("未知");
    expect(panel.querySelector('[data-testid="obs-health-心跳时效"] .obs-coverage-meter')).not.toBeNull();
    expect(panel.querySelector('[data-testid="obs-health-心跳时效"] .obs-coverage-meter__fill')).toBeNull();
    expect(panel.querySelector('[data-testid="obs-platform-health"]')?.textContent).not.toContain(
      "expectedSamples",
    );
    expect(panel.querySelector('[data-testid="obs-platform-health"]')?.textContent).not.toContain(
      "observedSamples",
    );
    expect(panel.querySelector('[data-testid="obs-health-租户授权"]')?.textContent).not.toContain(
      "目录分母",
    );
    expect(panel.querySelector('[data-testid="obs-health-租户授权"]')?.textContent).toContain(
      "1 已授权",
    );
    expect(panel.querySelector('[data-testid="obs-health-租户授权"]')?.textContent).toContain(
      "1 尚未确认",
    );
    expect(panel.querySelector('[data-testid="obs-health-租户授权"]')?.textContent).not.toMatch(
      /0 无授权/,
    );
    expect(panel.querySelector('[data-testid="obs-health-未映射事件"]')?.textContent).toContain(
      "不计入企业",
    );
    expect(panel.querySelector('[data-testid="obs-precise-query"]')?.textContent).toContain(
      "精确任务查询",
    );
    expect(panel.querySelector(".obs-pulse-grid")).toBeNull();
    expect(panel.querySelector('[role="tablist"][aria-label="观测视图"]')).toBeNull();
    expect(
      [...panel.querySelectorAll('[aria-label="平台观测视图"] button')].map(
        (row) => row.textContent,
      ),
    ).toEqual(["平台总览", "精确任务查询", "租户与授权", "覆盖与容量"]);
    expect(panel.querySelector(".obs-header h2")?.textContent ?? "").not.toContain("运行观测");
    expect(panel.querySelector(".obs-header h2")?.textContent ?? "").not.toContain(
      "实时运行与改善",
    );

    expect(panel.querySelector('[data-testid="obs-tenant-compare"]')?.textContent).toContain(
      "租户隔离与授权",
    );
    expect(panel.querySelector('[data-tenant-id="tenant-a"]')?.textContent).toContain(
      "华东正式企业",
    );
    expect(panel.querySelector('[data-tenant-id="tenant-a"]')?.textContent).toContain("已授权");
    expect(panel.querySelector('[data-tenant-id="tenant-a"]')?.textContent).toContain("未知");
    expect(panel.querySelector('[data-tenant-id="tenant-b"]')?.textContent).toContain("尚未确认");
    expect(panel.querySelector('[data-tenant-id="tenant-b"]')?.textContent).not.toContain("无授权");
    expect(panel.querySelector(".obs-plat-toolbar select[aria-label=观测数据源]")).not.toBeNull();
    expect(panel.querySelector(".obs-source")?.textContent).toContain("真实连接");
    expect(panel.querySelector(".obs-source")?.textContent).toContain("样例验收");
    expect(panel.querySelector(".obs-source")?.textContent).not.toContain("连接工作台数据源");
    expect(panel.querySelector(".obs-source")?.textContent).not.toContain("不影响独立精确任务查询");
    expect(panel.querySelector(".obs-source-label")).toBeNull();
    expect(panel.querySelector(".obs-source small")).toBeNull();
    expect(panel.querySelector('[data-tenant-id="tenant-b"]')?.textContent).not.toMatch(
      /近 7 天调用[\s\S]*\b0\b/,
    );

    const sample = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    sample.value = "sample";
    sample.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.textContent).toContain("物业示例（样例）");
    expect(panel.textContent).toContain("华北示例（样例）");
    expect(panel.textContent).toContain("交互验收样例");
    expect(panel.querySelectorAll("[data-tenant-id]")).toHaveLength(2);

    const tenant = panel.querySelector<HTMLSelectElement>("select[aria-label=租户筛选]")!;
    tenant.value = "sample-tenant-property";
    tenant.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelector("[data-tenant-filter]")?.getAttribute("data-tenant-filter")).toBe(
      "sample-tenant-property",
    );
    panel.querySelector<HTMLButtonElement>('[data-platform-page="capacity"]')!.click();
    await panel.updateComplete;
    const capacity = panel.querySelector('[data-testid="obs-platform-capacity"]');
    expect(capacity?.textContent).toContain("覆盖与容量");
    expect(capacity?.textContent).toContain("采样覆盖");
    expect(capacity?.textContent).toContain("心跳时效");
    expect(capacity?.textContent).toContain("登记并发");
    expect(capacity?.textContent).toContain("额度");
    const values = [...capacity!.querySelectorAll(".obs-cap-val")].map((node) => node.textContent);
    expect(values).toEqual(["未知", "未知", "未知", "未知"]);
    expect(values.some((value) => value?.includes("0%"))).toBe(false);
    expect(capacity?.textContent).not.toContain("expectedSamples");
    expect(capacity?.textContent).not.toContain("capacity_does_not_establish_task_outcome");
    expect(capacity?.querySelector(".obs-plat-card__head p")).toBeNull();
    panel.querySelector<HTMLButtonElement>('[data-platform-page="overview"]')!.click();
    await panel.updateComplete;
    expect(panel.querySelector('[data-testid="obs-platform-health"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="obs-precise-query"]')).not.toBeNull();
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
        authorized: true,
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
    expect(panel.querySelectorAll("[data-tenant-id]")).toHaveLength(0);
    expect(panel.textContent).toContain("暂无跨租户历史聚合查询能力");
    expect(panel.querySelector(".obs-pulse-grid")).toBeNull();
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
        authorized: true,
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
    expect(panel.querySelector('[data-action="pause"]')?.textContent).toContain("暂停刷新");
    expect(panel.querySelector(".obs-realtime-head")).toBeNull();
    expect(panel.textContent).not.toContain("从本次连接开始");
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
    expect(panel.querySelector(".obs-stream-foot")).toBeNull();
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
    panel.querySelector<HTMLButtonElement>("[data-run-id='client_next@engine_next']")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("client_next");
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("improvementEligible：false");
    panel.querySelector<HTMLButtonElement>('[aria-label="关闭证据"]')!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.querySelector("[data-run-id='client_next@engine_next']")).not.toBeNull();
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
        authorized: true,
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
    expect(panel.querySelector('[data-testid="obs-health-关联覆盖率"]')?.textContent).toContain(
      "未知",
    );
    expect(panel.querySelector('[data-testid="obs-health-心跳时效"]')?.textContent).toContain(
      "未知",
    );
    expect(panel.querySelector('[data-testid="obs-health-未映射事件"]')?.textContent).toContain(
      "当前企业暂无已映射运行",
    );
    expect(panel.querySelector(".obs-pulse-grid")).toBeNull();
    container.remove();
  });
});

describe("governance readonly intent integration", () => {
  it("renders summary records, selects details and hides live records in sample mode", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const selected: string[] = [];
    render(
      renderObservationWorkbench({
        role: "enterprise",
        tenantId: "t1",
        sessionKey: null,
        connected: true,
        authorized: true,
        observationHost: null,
        onSelectActionIntent: (id) => selected.push(id),
        actionIntents: {
          ok: true,
          mode: "summary",
          state: "present",
          detail: null,
          nextCursor: null,
          reasons: [],
          readOnly: true,
          items: [
            {
              actionIntentId: "intent-test",
              revision: 2,
              state: "effective",
              createdAt: 1,
              updatedAt: 2,
              target: { controlPlane: "test", targetType: "policy", targetId: "target" },
              source: { environment: "test", provenance: "injected", nonProduction: true },
              receipts: [],
              readback: null,
              verification: null,
            },
          ],
        },
      }),
      container,
    );
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    const tabs = [
      ...panel.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="观测视图"] button',
      ),
    ];
    tabs[2].click();
    await panel.updateComplete;
    expect(panel.textContent).toContain("记录状态：effective");
    expect(panel.textContent).toContain("改善记录与显式任务版本对照独立于连接工作台筛选");
    expect(panel.textContent).toContain("improvementEligible 保持为 false");
    expect(panel.querySelector('[aria-label="显式对照查询"]')).not.toBeNull();
    panel.querySelector<HTMLButtonElement>('[data-intent-id="intent-test"]')!.click();
    expect(selected).toEqual(["intent-test"]);
    panel.source = "sample";
    await panel.updateComplete;
    expect(panel.querySelector('[data-intent-id="intent-test"]')).toBeNull();
    expect(panel.textContent).toContain("样例模式不展示真实改善记录");
    panel.source = "live";
    panel.actionIntents = null;
    await panel.updateComplete;
    expect(panel.textContent).toContain("改善关联记录未供给");
    container.remove();
  });
});

describe("explicit comparison input", () => {
  it("requires complete explicit UTC references and submits only on user request", async () => {
    const selections: unknown[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "enterprise",
        tenantId: "t1",
        sessionKey: null,
        connected: true,
        authorized: true,
        observationHost: null,
        onComparisonRefs: (refs) => selections.push(refs),
      }),
      container,
    );
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    panel.querySelectorAll<HTMLButtonElement>('[aria-label="观测视图"] button')[1].click();
    await panel.updateComplete;
    panel.querySelectorAll<HTMLButtonElement>('[aria-label="分析维度"] button')[3].click();
    await panel.updateComplete;
    const submit = () =>
      [...panel.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent === "读取对照")!
        .click();
    submit();
    await panel.updateComplete;
    expect(selections.filter(Boolean)).toHaveLength(0);
    const set = async (label: string, value: string) => {
      const input = panel.querySelector<HTMLInputElement>('[aria-label="' + label + '"]')!;
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await panel.updateComplete;
    };
    for (const side of ["baseline", "candidate"]) {
      await set(side + " 数字人", "main");
      await set(side + " 任务", side + "-task");
      await set(side + " 结果版本", "1");
      await set(
        side + " 开始UTC",
        side === "baseline" ? "2026-11-01T00:00:00Z" : "2026-11-02T00:00:00Z",
      );
      await set(
        side + " 结束UTC",
        side === "baseline" ? "2026-11-02T00:00:00Z" : "2026-11-03T00:00:00Z",
      );
    }
    expect(selections.filter(Boolean)).toHaveLength(0);
    await set("candidate 结果版本", "9007199254740993");
    submit();
    await panel.updateComplete;
    expect(selections.filter(Boolean)).toHaveLength(0);
    await set("candidate 结果版本", "2");
    submit();
    await panel.updateComplete;
    expect(selections.filter(Boolean)).toHaveLength(1);
    expect(selections.at(-1)).toMatchObject({
      baseline: { refs: [{ taskId: "baseline-task", agentId: "main", outcomeVersion: 1 }] },
      candidate: { refs: [{ taskId: "candidate-task", agentId: "main", outcomeVersion: 2 }] },
    });
    await set("baseline 任务", "");
    expect(selections.at(-1)).toBeNull();
    container.remove();
  });
});

describe("R5 incremental wiring", () => {
  async function mount(
    props: Parameters<typeof renderObservationWorkbench>[0],
  ): Promise<{ container: HTMLDivElement; panel: OpenBotObservationWorkbench }> {
    const container = document.createElement("div");
    document.body.append(container);
    render(renderObservationWorkbench(props), container);
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    return { container, panel };
  }

  function metricDisplays(panel: Element) {
    return [...panel.querySelectorAll(".obs-pulse-card")].map((card) => ({
      key: card.getAttribute("data-metric"),
      text: card.querySelector("strong")?.textContent ?? "",
    }));
  }

  it("keeps the top-stat denominator when a metric filters only the list", async () => {
    const { container, panel } = await mount({
      role: "enterprise",
      tenantId: "demo",
      sessionKey: "agent:one:main",
      connected: true,
      authorized: true,
      observationHost: {},
    });
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(3);
    const before = metricDisplays(panel);
    panel.querySelector<HTMLButtonElement>('[data-metric="active_runs"]')!.click();
    await panel.updateComplete;
    expect(metricDisplays(panel)).toEqual(before);
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(1);
    expect(panel.querySelector('[data-testid="obs-metric-scope-hint"]')?.textContent).toContain(
      "顶部指标仍按原筛选集合统计，分母未改变",
    );
    panel.querySelector<HTMLButtonElement>('[data-action="clear-metric-filter"]')!.click();
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(3);
    expect(metricDisplays(panel)).toEqual(before);
    expect(panel.querySelector('[data-testid="obs-metric-scope-hint"]')).toBeNull();
    container.remove();
  });

  it("freezes metrics, list, and open evidence on the same paused slice, then clears on revoke", async () => {
    const host = {};
    recordRuntimeObservation(
      host,
      "agent:main",
      {
        runId: "client_pause",
        sourceRunId: "engine_pause",
        sessionKey: "agent:main",
        seq: 1,
        ts: 10,
        stream: "lifecycle",
        data: { phase: "start" },
      },
      100,
    );
    const { container, panel } = await mount({
      role: "enterprise",
      tenantId: "demo",
      sessionKey: "agent:main",
      connected: true,
      observationHost: host,
      scopes: ["operator.read"],
    });
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await panel.updateComplete;
    panel.querySelector<HTMLButtonElement>("[data-run-id='client_pause@engine_pause']")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("client_pause");
    const metricsBeforePause = metricDisplays(panel);
    const drawerBeforePause = panel.querySelector(".obs-drawer")?.textContent;
    panel.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    await panel.updateComplete;
    recordRuntimeObservation(
      host,
      "agent:main",
      {
        runId: "client_later",
        sourceRunId: "engine_later",
        sessionKey: "agent:main",
        seq: 1,
        ts: 40,
        stream: "lifecycle",
        data: { phase: "start" },
      },
      400,
    );
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await panel.updateComplete;
    expect(metricDisplays(panel)).toEqual(metricsBeforePause);
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(1);
    expect(panel.querySelector(".obs-drawer")?.textContent).toBe(drawerBeforePause);
    expect(panel.textContent).not.toContain("client_later");
    panel.scopes = [];
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(0);
    expect(panel.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前授权已失效",
    );
    expect(panel.textContent).not.toContain("client_pause");
    expect(panel.textContent).not.toContain("client_later");
    container.remove();
    clearRuntimeObservations(host);
  });

  it("does not restore a denied drawer from a directly supplied URL and strips run/drawer", async () => {
    const previous = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({}, "", `${window.location.pathname}?run=sample-partial&drawer=1`);
    const { container, panel } = await mount({
      role: "enterprise",
      tenantId: "demo",
      sessionKey: "agent:one:main",
      connected: true,
      observationHost: {},
      scopes: [],
      initialRunId: "sample-partial",
      initialDrawer: true,
    });
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(0);
    expect(window.location.search).not.toContain("drawer=");
    expect(window.location.search).not.toContain("run=");
    expect(panel.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前授权已失效",
    );
    container.remove();
    window.history.replaceState({}, "", previous);
  });

  it("drops a stale list and drawer when switching from sample to live", async () => {
    const { container, panel } = await mount({
      role: "enterprise",
      tenantId: "demo",
      sessionKey: "agent:one:main",
      connected: true,
      authorized: true,
      observationHost: {},
    });
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    panel.querySelector<HTMLButtonElement>("[data-run-id=sample-partial]")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("投递链路复核");
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("engine_C");
    selector.value = "live";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.querySelector("[data-run-id=sample-partial]")).toBeNull();
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(0);
    expect(panel.textContent).not.toContain("投递链路复核");
    expect(panel.textContent).not.toContain("engine_C");
    expect(panel.querySelector('[data-observation-source="live"]')).not.toBeNull();
    container.remove();
  });

  it("does not release run details when authorized is omitted or not yet received", async () => {
    const { container, panel } = await mount({
      role: "enterprise",
      tenantId: "demo",
      sessionKey: "agent:one:main",
      connected: true,
      observationHost: {},
    });
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(0);
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前授权尚未确认",
    );
    expect(panel.querySelector('[data-testid="obs-access-notice"]')?.textContent).not.toContain(
      "已失效",
    );
    container.remove();
  });

  it("uses server-confirmed tenantGrant and withholds run details while it is unknown", async () => {
    const { container, panel } = await mount({
      role: "platform",
      tenantId: null,
      sessionKey: null,
      connected: true,
      authorized: true,
      observationHost: {},
      tenantGrants: {
        "sample-tenant-property": "unknown",
        "sample-tenant-north": "none",
      },
    });
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;

    const tenant = panel.querySelector<HTMLSelectElement>("select[aria-label=租户筛选]")!;
    tenant.value = "sample-tenant-property";
    tenant.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(0);
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前租户授权尚未确认",
    );
    expect(panel.querySelector('[data-testid="obs-access-notice"]')?.textContent).not.toContain(
      "无授权",
    );

    tenant.value = "sample-tenant-north";
    tenant.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(0);
    expect(panel.querySelector('[data-testid="obs-access-notice"]')?.textContent).toContain(
      "当前租户筛选无授权",
    );

    panel.tenantGrants = { "sample-tenant-property": "granted", "sample-tenant-north": "none" };
    tenant.value = "sample-tenant-property";
    tenant.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    expect(panel.querySelector('[data-testid="obs-access-notice"]')).toBeNull();
    const input = panel.querySelector<HTMLInputElement>('[aria-label="精确任务或运行标识"]')!;
    input.value = "sample-personal";
    input.dispatchEvent(new Event("input"));
    panel.querySelector<HTMLButtonElement>(".obs-query-submit")!.click();
    await panel.updateComplete;
    expect(panel.querySelector('[data-testid="obs-query-result"]')?.textContent).toContain(
      "周报资料整理",
    );
    expect(panel.querySelectorAll(".obs-run")).toHaveLength(0);

    input.value = "sample-collaboration";
    input.dispatchEvent(new Event("input"));
    panel.querySelector<HTMLButtonElement>(".obs-query-submit")!.click();
    await panel.updateComplete;
    expect(panel.querySelector('[data-testid="obs-query-result"]')?.textContent).toContain(
      "当前授权范围内未找到匹配记录",
    );
    expect(panel.querySelector('[data-testid="obs-query-result"]')?.textContent).not.toContain(
      "华北示例",
    );
    container.remove();
  });

  it("uses the same miss copy for an unknown identifier and does not hint at another tenant", async () => {
    const { container, panel } = await mount({
      role: "platform",
      tenantId: null,
      sessionKey: null,
      connected: true,
      authorized: true,
      observationHost: {},
      tenantGrants: {
        "sample-tenant-property": "granted",
        "sample-tenant-north": "granted",
      },
    });
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    const tenant = panel.querySelector<HTMLSelectElement>("select[aria-label=租户筛选]")!;
    tenant.value = "sample-tenant-property";
    tenant.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    const input = panel.querySelector<HTMLInputElement>('[aria-label="精确任务或运行标识"]')!;
    for (const identifier of ["does-not-exist", "sample-collaboration", "SAMPLE-PERSONAL"]) {
      input.value = identifier;
      input.dispatchEvent(new Event("input"));
      panel.querySelector<HTMLButtonElement>(".obs-query-submit")!.click();
      await panel.updateComplete;
      expect(panel.querySelector('[data-testid="obs-query-result"]')?.textContent).toContain(
        "当前授权范围内未找到匹配记录",
      );
      expect(panel.querySelector('[data-testid="obs-query-result"]')?.textContent).not.toContain(
        "华北示例",
      );
      expect(panel.querySelector(".obs-drawer")).toBeNull();
    }
    container.remove();
  });
});

describe("R5 enterprise IA alignment", () => {
  async function mountEnterprise() {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "enterprise",
        tenantId: "demo",
        sessionKey: "agent:one:main",
        connected: true,
        authorized: true,
        observationHost: {},
      }),
      container,
    );
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    return { container, panel };
  }

  it("does not restore the filter status strip or other density-cut copy", async () => {
    const { container, panel } = await mountEnterprise();
    expect(panel.querySelector('[data-testid="obs-status-line"]')).toBeNull();
    expect(panel.textContent).not.toContain("本次连接起");
    expect(panel.textContent).not.toContain("从本次连接开始");
    expect(panel.textContent).not.toContain("已连接 ·");
    expect(panel.querySelector('[data-action="pause"]')?.textContent).toContain("暂停刷新");
    expect(panel.querySelector("select[aria-label=观测数据源]")).not.toBeNull();
    expect(panel.querySelector(".obs-wb-filters__head")).toBeNull();
    expect(panel.querySelector('[aria-label="连接工作台筛选"]')?.textContent).not.toContain(
      "连接工作台筛选",
    );
    expect(panel.textContent).not.toContain("当前企业 · 个人与共享终态分开");
    expect(panel.textContent).not.toContain("当前连接观察片段");
    expect(panel.textContent).not.toContain("等待第一次事件");
    expect(panel.textContent).not.toContain("尚无真实事件");
    expect(panel.querySelector('[aria-label="需要关注的运行"]')?.textContent).toContain("全部关注");
    expect(panel.querySelector('[aria-label="需要关注的运行"]')?.textContent).toContain("规则发现");
    expect(panel.querySelector('[aria-label="观测闭环说明"]')?.textContent).toContain("已观察");
    expect(panel.querySelector('[aria-label="观测闭环说明"]')?.textContent).toContain(
      "从一次运行的证据开始，而不是从一张报表结束",
    );
    container.remove();
  });

  it("shows analysis as a master-detail split and opens the drawer only from complete evidence", async () => {
    const { container, panel } = await mountEnterprise();
    const selector = panel.querySelector<HTMLSelectElement>("select[aria-label=观测数据源]")!;
    selector.value = "sample";
    selector.dispatchEvent(new Event("change"));
    await panel.updateComplete;
    const issueTable = panel.querySelector(".obs-issue-table");
    expect(issueTable?.textContent).toContain("主状态");
    expect(issueTable?.textContent).toContain("影响");
    const tabs = [
      ...panel.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="观测视图"] button',
      ),
    ];
    tabs[1].click();
    await panel.updateComplete;
    expect(panel.querySelector('[data-testid="obs-analysis-split"]')).not.toBeNull();
    expect(panel.querySelector(".obs-list-head")?.textContent).toContain("运行列表");
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    panel.querySelector<HTMLButtonElement>("[data-run-id=sample-partial]")!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")).toBeNull();
    expect(panel.querySelector('[data-testid="obs-analysis-detail"]')?.textContent).toContain(
      "完整运行证据",
    );
    panel.querySelector<HTMLButtonElement>('[data-testid="obs-open-evidence"]')!.click();
    await panel.updateComplete;
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("运行标识与状态");
    expect(panel.querySelector(".obs-drawer")?.textContent).toContain("improvementEligible：false");
    container.remove();
  });
});

describe("platform first-screen snapshot binding", () => {
  const mount = async (request: (method: string, params?: unknown) => Promise<unknown>) => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderObservationWorkbench({
        role: "platform",
        tenantId: null,
        sessionKey: null,
        connected: true,
        authorized: true,
        scopes: ["operator.read", "operator.platform"],
        observationHost: {},
        client: { connected: true, request },
        gatewayMethods: ["diagnosis.observation.query"],
        enterpriseDirectory: [
          { tenantId: "tenant-a", label: "华东正式企业", status: "paid", tenantGrant: "granted" },
        ],
      }),
      container,
    );
    await customElements.whenDefined("openbot-observation-workbench");
    const panel = container.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await panel.updateComplete;
    await Promise.resolve();
    await Promise.resolve();
    await panel.updateComplete;
    return { container, panel };
  };

  it("renders a ring and ratio when the window snapshot supplies a real denominator", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      expect(method).toBe("diagnosis.observation.query");
      expect(params).toEqual(
        expect.objectContaining({ platformWindow: true }),
      );
      expect(params).not.toEqual(expect.objectContaining({ agentId: expect.anything() }));
      expect(params).not.toEqual(expect.objectContaining({ taskId: expect.anything() }));
      return {
        ok: true,
        coverage: { attemptedCount: 5, fullyLinkedCount: 3, invalidCount: 1, link: 0.6 },
        heartbeat: { expectedSamples: 4, observedSamples: 2 },
      };
    });
    const { container, panel } = await mount(request);
    expect(
      panel.querySelector('[data-testid="obs-health-关联覆盖率"] .obs-cap-val')?.textContent,
    ).toBe("3/5 · 60%");
    expect(
      panel.querySelector('[data-testid="obs-health-关联覆盖率"] .obs-coverage-meter__fill'),
    ).not.toBeNull();
    expect(
      panel.querySelector('[data-testid="obs-health-心跳时效"] .obs-cap-val')?.textContent,
    ).toBe("2/4");
    expect(
      panel.querySelector('[data-testid="obs-health-心跳时效"] .obs-coverage-meter__fill'),
    ).not.toBeNull();
    expect(panel.querySelector('[data-testid="obs-platform-health"]')?.textContent).not.toContain(
      "expectedSamples",
    );
    panel.querySelector<HTMLButtonElement>('[data-platform-page="capacity"]')!.click();
    await panel.updateComplete;
    const capacity = panel.querySelector('[data-testid="obs-platform-capacity"]');
    const values = [...capacity!.querySelectorAll(".obs-cap-val")].map((node) => node.textContent);
    expect(values[0]).toBe("3/5 · 60%");
    expect(values[1]).toBe("2/4");
    expect(values[2]).toBe("未知");
    expect(values[3]).toBe("未知");
    expect(capacity?.querySelector(".obs-coverage-meter__fill")).not.toBeNull();
    container.remove();
  });

  it("keeps first-screen coverage unknown when the snapshot has no denominator, and ignores precise-query evidence", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      coverage: { attemptedCount: 0, fullyLinkedCount: 0, link: null },
      heartbeat: { expectedSamples: null, observedSamples: 1 },
    }));
    const { container, panel } = await mount(request);
    expect(
      panel.querySelector('[data-testid="obs-health-关联覆盖率"] .obs-cap-val')?.textContent,
    ).toBe("未知");
    expect(
      panel.querySelector('[data-testid="obs-health-关联覆盖率"] .obs-coverage-meter__fill'),
    ).toBeNull();
    expect(
      panel.querySelector('[data-testid="obs-health-心跳时效"] .obs-cap-val')?.textContent,
    ).toBe("未知");
    expect(panel.textContent).not.toContain("0%");
    const query = panel.querySelector<HTMLInputElement>('input[aria-label="精确任务或运行标识"]')!;
    query.value = "anything";
    query.dispatchEvent(new Event("input"));
    panel.querySelector<HTMLButtonElement>(".obs-query-submit")!.click();
    await panel.updateComplete;
    expect(
      panel.querySelector('[data-testid="obs-health-关联覆盖率"] .obs-cap-val')?.textContent,
    ).toBe("未知");
    expect(request).toHaveBeenCalled();
    expect(
      request.mock.calls.every(([, params]) =>
        Boolean(params && typeof params === "object" && "platformWindow" in (params as object)),
      ),
    ).toBe(true);
    container.remove();
  });
});
