// @vitest-environment node
// Feature: model-entitlement-chain P6 — 平台套餐⇄模型视图模型
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PlatformModelBindingOverview } from "../types.ts";
import { buildPlatformModelBindingView, toggleModelForPlan } from "../view-model.ts";

const overview: PlatformModelBindingOverview = {
  catalog: ["ollama/llama3.2", "api-proxy-deepseek/deepseek-chat"],
  plans: [
    {
      planId: "plan-a",
      name: "入门版",
      status: "active",
      currentVersionId: "pv-a",
      allowedModelIds: ["ollama/llama3.2"],
    },
    {
      planId: "plan-b",
      name: "专业版",
      status: "active",
      currentVersionId: "pv-b",
      allowedModelIds: ["ollama/llama3.2", "api-proxy-deepseek/deepseek-chat"],
    },
  ],
  reverseIndex: {
    "ollama/llama3.2": ["plan-a", "plan-b"],
    "api-proxy-deepseek/deepseek-chat": ["plan-b"],
  },
};

describe("buildPlatformModelBindingView", () => {
  it("正向矩阵: 每个套餐 × 目录模型的勾选态", () => {
    const v = buildPlatformModelBindingView(overview);
    const rowA = v.matrix.find((r) => r.planId === "plan-a")!;
    const cheap = rowA.cells.find((c) => c.modelId === "api-proxy-deepseek/deepseek-chat")!;
    const local = rowA.cells.find((c) => c.modelId === "ollama/llama3.2")!;
    expect(local.included).toBe(true);
    expect(cheap.included).toBe(false);
    // 每行覆盖完整目录
    expect(rowA.cells.length).toBe(2);
  });

  it("反向视图: 模型 → 含它的套餐名", () => {
    const v = buildPlatformModelBindingView(overview);
    const localRow = v.reverse.find((r) => r.modelId === "ollama/llama3.2")!;
    expect([...localRow.planNames].toSorted()).toEqual(["入门版", "专业版"].toSorted());
    const cheapRow = v.reverse.find((r) => r.modelId === "api-proxy-deepseek/deepseek-chat")!;
    expect(cheapRow.planNames).toEqual(["专业版"]);
  });

  it("套餐绑定了目录外的模型仍可见(便于取消)", () => {
    const ov: PlatformModelBindingOverview = {
      catalog: ["ollama/llama3.2"],
      plans: [
        {
          planId: "p",
          name: "X",
          status: "active",
          currentVersionId: "pv",
          allowedModelIds: ["ollama/llama3.2", "legacy/removed"],
        },
      ],
      reverseIndex: { "ollama/llama3.2": ["p"], "legacy/removed": ["p"] },
    };
    const v = buildPlatformModelBindingView(ov);
    expect(v.catalog).toContain("legacy/removed");
    const row = v.matrix[0];
    expect(row.cells.find((c) => c.modelId === "legacy/removed")?.included).toBe(true);
  });
});

describe("toggleModelForPlan", () => {
  it("勾选/取消产出新的 allowedModelIds(纯函数,不改输入)", () => {
    const added = toggleModelForPlan(overview, "plan-a", "api-proxy-deepseek/deepseek-chat", true);
    expect(added.toSorted()).toEqual(["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"]);
    const removed = toggleModelForPlan(overview, "plan-a", "ollama/llama3.2", false);
    expect(removed).toEqual([]);
    // 原 overview 未被修改
    expect(overview.plans[0].allowedModelIds).toEqual(["ollama/llama3.2"]);
  });

  it("Property: 切换后该套餐集合恒含/不含目标模型且元素唯一", () => {
    const arbModel = fc.constantFrom("ollama/llama3.2", "api-proxy-deepseek/deepseek-chat", "x/y");
    fc.assert(
      fc.property(arbModel, fc.boolean(), (modelId, included) => {
        const next = toggleModelForPlan(overview, "plan-b", modelId, included);
        expect(new Set(next).size).toBe(next.length); // 唯一
        expect(next.includes(modelId)).toBe(included);
      }),
      { numRuns: 100 },
    );
  });
});
