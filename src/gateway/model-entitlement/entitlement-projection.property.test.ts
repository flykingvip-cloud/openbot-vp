// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeEntitlementProjection } from "./entitlement-projection.js";

const modelId = () =>
  fc
    .tuple(
      fc.constantFrom("api-proxy-deepseek", "api-proxy-gpt", "custom-x"),
      fc.constantFrom("deepseek-chat", "gpt-5.2", "mini"),
    )
    .map(([p, m]) => `${p}/${m}`);

describe("computeEntitlementProjection — Property 2 / 确定性", () => {
  it("无 active 订阅（planVersionId=null）→ shouldProject=false（保留 missing 态）", () => {
    const res = computeEntitlementProjection({
      tenantId: "t1",
      planVersionId: null,
      bindingAllowedModelIds: ["api-proxy-gpt/gpt-5.2"],
    });
    expect(res.shouldProject).toBe(false);
    expect(res.allowedModelIds).toEqual([]);
  });

  it("有订阅但版本无绑定 → resolved 但空集（hard deny 语义）", () => {
    const res = computeEntitlementProjection({
      tenantId: "t1",
      planVersionId: "pv-1",
      bindingAllowedModelIds: null,
    });
    expect(res.shouldProject).toBe(true);
    expect(res.planVersionId).toBe("pv-1");
    expect(res.allowedModelIds).toEqual([]);
  });

  it("投影 = 绑定的 allowedModelIds（去重），且为确定性纯函数", () => {
    fc.assert(
      fc.property(fc.array(modelId(), { maxLength: 8 }), (binding) => {
        const input = {
          tenantId: "t1",
          planVersionId: "pv-1",
          bindingAllowedModelIds: binding,
        };
        const a = computeEntitlementProjection(input);
        const b = computeEntitlementProjection(input);
        // 确定性
        expect(a.allowedModelIds).toEqual(b.allowedModelIds);
        // 投影 ⊆ 绑定（去重后）
        const bindingSet = new Set(binding);
        for (const id of a.allowedModelIds) {
          expect(bindingSet.has(id)).toBe(true);
        }
        // 无重复
        expect(new Set(a.allowedModelIds).size).toBe(a.allowedModelIds.length);
      }),
    );
  });
});
