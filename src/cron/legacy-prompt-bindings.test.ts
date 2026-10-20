import { describe, expect, it } from "vitest";
import { findLegacyPromptTokens, migrateLegacyPromptBindings } from "./legacy-prompt-bindings.js";

describe("legacy-prompt-bindings", () => {
  it("detects legacy prompt tokens", () => {
    expect(findLegacyPromptTokens("日报 {{today}} 与 {{sales_data}}")).toEqual([
      "{{today}}",
      "{{sales_data}}",
    ]);
  });

  it("migrates today to runtime binding marker", () => {
    const result = migrateLegacyPromptBindings({
      intentText: "输出报告（{{today}}）",
      dataBindings: [],
    });
    expect(result.migratedTokens).toEqual(["{{today}}"]);
    expect(result.intentText).toContain("{{bind:runtime-today}}");
    expect(result.dataBindings[0]?.kind).toBe("runtime_date");
  });

  it("maps sales_data to best matching granted capability", () => {
    const result = migrateLegacyPromptBindings({
      intentText: "分析 {{sales_data}}",
      dataBindings: [],
      capabilities: [
        {
          id: "mock-customer-profile",
          title: "客户画像能力",
          summary: "客户摘要",
          scenarios: ["客户画像"],
          accessState: "requestable",
        },
        {
          id: "mock-sales-analysis",
          title: "销售分析能力",
          summary: "CRM 与订单销售洞察",
          scenarios: ["销售分析"],
          accessState: "granted",
        },
      ],
    });
    expect(result.migratedTokens).toEqual(["{{sales_data}}"]);
    expect(result.dataBindings[0]?.resourceId).toBe("mock-sales-analysis");
    expect(result.intentText).toContain("{{bind:legacy-sales-data}}");
  });

  it("reports unresolved tokens when no capability match", () => {
    const result = migrateLegacyPromptBindings({
      intentText: "导出 {{customer_list}}",
      dataBindings: [],
      capabilities: [],
    });
    expect(result.migratedTokens).toEqual([]);
    expect(result.unresolvedTokens).toEqual(["{{customer_list}}"]);
  });
});
