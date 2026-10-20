import { describe, expect, it } from "vitest";
import { applyKnowledgeCompliance, ensureControlledObjectGovernance } from "./compliance.js";

describe("knowledge compliance", () => {
  it("ensures enterprise objects always expose source, scope, and masking", () => {
    const object = ensureControlledObjectGovernance({
      id: "obj:enterprise:demo",
      title: "Demo",
      source: "enterprise",
      kind: "document",
      summary: "demo",
      tags: ["demo"],
      updatedAt: Date.now(),
    });
    expect(object.sourceSystem).toBeTruthy();
    expect(object.scopeLabel).toBeTruthy();
    expect(object.maskingSummary).toBeTruthy();
  });

  it("preserves explicit governance metadata", () => {
    const object = applyKnowledgeCompliance(
      {
        id: "obj:data:cap-1",
        title: "客户画像能力",
        source: "data",
        kind: "metric",
        summary: "demo",
        tags: ["客户画像"],
        updatedAt: Date.now(),
      },
      {
        sourceSystem: "Salesforce CRM",
        scopeLabel: "已授权",
        maskingSummary: "已按席位授权与脱敏策略展示",
        traceRefs: ["trace-1"],
      },
    );
    expect(object.sourceSystem).toBe("Salesforce CRM");
    expect(object.traceRefs).toEqual(["trace-1"]);
  });
});
