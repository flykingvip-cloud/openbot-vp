import { describe, expect, it } from "vitest";
import { applyProjectionTemplate } from "./projection-template-engine.js";

const spec = {
  projectionKey: "yonyou_tplus_warehouse",
  displayName: "001-用友T+仓库",
  objectKind: "data" as const,
  category: "inventory" as const,
};

const gatewayResponse = { maskedFields: [], scopeApplied: "tenant:test" };

describe("applyProjectionTemplate AggregateTemplate", () => {
  it("aggregates items payloads", () => {
    const result = applyProjectionTemplate({
      templateKey: "AggregateTemplate",
      spec,
      gatewayData: { items: [{ Code: "01", Name: "主仓" }] },
      gatewayResponse,
    });
    expect(result.payload).toEqual({
      count: 1,
      items: [{ Code: "01", Name: "主仓" }],
    });
  });

  it("aggregates yonyou-style records payloads into items Feed", () => {
    const result = applyProjectionTemplate({
      templateKey: "AggregateTemplate",
      spec,
      gatewayData: { records: [{ Code: "01", Name: "模拟仓库" }] },
      gatewayResponse,
    });
    expect(result.title).toContain("汇总");
    expect(result.payload).toEqual({
      count: 1,
      items: [{ Code: "01", Name: "模拟仓库" }],
    });
  });

  it("aggregates bare arrays", () => {
    const result = applyProjectionTemplate({
      templateKey: "AggregateTemplate",
      spec,
      gatewayData: [{ id: 1 }],
      gatewayResponse,
    });
    expect(result.payload).toEqual({ count: 1, items: [{ id: 1 }] });
  });

  it("aggregates inventory QueryPage Data nested under records", () => {
    const result = applyProjectionTemplate({
      templateKey: "AggregateTemplate",
      spec,
      gatewayData: {
        records: {
          TotalCount: 1,
          TotalPage: 1,
          CurrentPage: 1,
          Data: [{ Code: "10001", Name: "扇子" }],
        },
      },
      gatewayResponse,
    });
    expect(result.payload).toEqual({
      count: 1,
      items: [{ Code: "10001", Name: "扇子" }],
    });
  });

  it("aggregates bare Data page objects without records wrapper", () => {
    const result = applyProjectionTemplate({
      templateKey: "AggregateTemplate",
      spec,
      gatewayData: {
        TotalCount: 1,
        Data: [{ Code: "01", Name: "温州仓" }],
      },
      gatewayResponse,
    });
    expect(result.payload).toEqual({
      count: 1,
      items: [{ Code: "01", Name: "温州仓" }],
    });
  });
});
