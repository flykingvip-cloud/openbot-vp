// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import {
  buildEmployeeModelUsageView,
  buildEmployeeModelView,
} from "../capability/model-authorization/view-model.ts";
import { renderEmployeeModelAccess } from "./employee-model-access.ts";

function mountSummary(summary: Parameters<typeof buildEmployeeModelView>[0]): HTMLDivElement {
  const container = document.createElement("div");
  render(renderEmployeeModelAccess({ view: buildEmployeeModelView(summary) }), container);
  return container;
}

describe("renderEmployeeModelAccess (browser)", () => {
  it("可用时列出模型并显示可用状态", async () => {
    const container = mountSummary({
      modelIds: ["p/b", "p/a"],
      state: "resolved",
      reason: "resolved from enterprise ceiling ∩ seat grant ∩ active model set",
      seatId: "seat-9",
    });
    await Promise.resolve();
    const text = container.textContent ?? "";
    expect(text).toContain("可用");
    expect(text).toContain("a");
    expect(text).toContain("b");
    expect(text).toContain("2 个可用模型");
    // 员工端不展示 seatId / 内部解析文案
    expect(text).not.toContain("seat-9");
    expect(text).not.toContain("enterprise ceiling");
    const items = container.querySelectorAll(".employee-model-access__model");
    expect(items.length).toBe(2);
  });

  it("missing 状态展示未配置而非被拒", async () => {
    const container = mountSummary({ modelIds: [], state: "missing", reason: "未配置" });
    await Promise.resolve();
    const badge = container.querySelector("[data-status]")!;
    expect(badge.getAttribute("data-status")).toBe("未配置授权");
  });

  it("resolved 空集展示被拒原因", async () => {
    const container = mountSummary({
      modelIds: [],
      state: "resolved",
      reason: "授权集合为空，已被拒绝",
    });
    await Promise.resolve();
    const text = container.textContent ?? "";
    expect(text).toContain("已被拒绝");
    expect(text).toContain("授权集合为空");
  });

  it("渲染各模型消费量：总计、条形与每模型指标", async () => {
    const container = document.createElement("div");
    const usage = buildEmployeeModelUsageView({
      entitlementModelIds: ["openai/gpt-4o"],
      byModel: [
        {
          provider: "openai",
          model: "gpt-4o",
          count: 4,
          totals: { input: 300, output: 900, totalTokens: 1200, totalCost: 0.42 },
        },
        {
          provider: "openclaw",
          model: "gateway-injected",
          count: 0,
          totals: { input: 0, output: 0, totalTokens: 0, totalCost: 0 },
        },
      ],
      windowDays: 30,
    });
    render(
      renderEmployeeModelAccess({
        view: buildEmployeeModelView({
          modelIds: ["openai/gpt-4o"],
          state: "resolved",
          reason: "可用",
          seatId: "seat-1",
        }),
        usage,
      }),
      container,
    );
    await Promise.resolve();
    const text = container.textContent ?? "";
    expect(text).toContain("模型消费量");
    expect(text).toContain("近 30 天");
    expect(text).toContain("1,200");
    expect(text).toContain("openai/gpt-4o");
    expect(text).not.toContain("总成本");
    expect(text).not.toContain("$0.42");
    expect(text).not.toContain("$");
    expect(text).not.toContain("统计范围");
    expect(text).not.toContain("gateway-injected");
    expect(container.querySelector(".employee-model-usage__foot")).toBeNull();
    const bar = container.querySelector<HTMLElement>(".employee-model-usage__bar");
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("style") ?? "").toContain("width: 100%");
  });

  it("无用量时给出近 30 天空态提示", async () => {
    const container = document.createElement("div");
    const usage = buildEmployeeModelUsageView({
      entitlementModelIds: ["openai/gpt-4o"],
      byModel: [],
      windowDays: 30,
    });
    render(
      renderEmployeeModelAccess({
        view: buildEmployeeModelView({
          modelIds: ["openai/gpt-4o"],
          state: "resolved",
          reason: "可用",
        }),
        usage,
      }),
      container,
    );
    await Promise.resolve();
    expect(container.textContent ?? "").toContain("近 30 天暂无模型调用记录");
  });
});
