// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeEffectiveModelSet, isModelAllowed } from "./effective-set.js";
import type { EnterpriseModelEntitlement, SeatModelGrant } from "./types.js";

const modelId = () =>
  fc
    .tuple(
      fc.constantFrom("api-proxy-deepseek", "api-proxy-gpt", "custom-x", "api-proxy-claude"),
      fc.constantFrom("deepseek-chat", "gpt-5.2", "claude-4.5", "mini"),
    )
    .map(([p, m]) => `${p}/${m}`);

const modelIds = () => fc.array(modelId(), { maxLength: 8 });

function entitlement(allowed: string[]): EnterpriseModelEntitlement {
  return { tenantId: "t1", allowedModelIds: allowed, updatedAt: "2026-01-01T00:00:00.000Z" };
}

function grant(granted: string[], status: "active" | "revoked" = "active"): SeatModelGrant {
  return {
    tenantId: "t1",
    subjectType: "seat",
    subjectId: "s1",
    seatId: "s1",
    grantedModelIds: granted,
    status,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeEffectiveModelSet — Property 2 包含链单调", () => {
  it("EffectiveModelSet ⊆ 企业 entitlement，且 ⊆ 平台目录(active)", () => {
    fc.assert(
      fc.property(modelIds(), modelIds(), modelIds(), (ent, grnt, catalog) => {
        const res = computeEffectiveModelSet({
          entitlement: entitlement(ent),
          grant: grant(grnt),
          catalogActiveModelIds: catalog,
        });
        const entSet = new Set(ent);
        const catSet = new Set(catalog);
        for (const id of res.allowedModelIds) {
          expect(entSet.has(id)).toBe(true);
          expect(catSet.has(id)).toBe(true);
        }
      }),
    );
  });

  it("有 active grant 时 EffectiveModelSet ⊆ grant", () => {
    fc.assert(
      fc.property(modelIds(), modelIds(), modelIds(), (ent, grnt, catalog) => {
        const res = computeEffectiveModelSet({
          entitlement: entitlement(ent),
          grant: grant(grnt),
          catalogActiveModelIds: catalog,
        });
        const grantSet = new Set(grnt);
        for (const id of res.allowedModelIds) {
          expect(grantSet.has(id)).toBe(true);
        }
      }),
    );
  });
});

describe("computeEffectiveModelSet — Property 3 两态区分", () => {
  it("无企业 entitlement → state=missing（不等同于已解析空集）", () => {
    const res = computeEffectiveModelSet({
      entitlement: null,
      grant: grant(["api-proxy-gpt/gpt-5.2"]),
      catalogActiveModelIds: ["api-proxy-gpt/gpt-5.2"],
    });
    expect(res.state).toBe("missing");
    expect(res.allowedModelIds).toEqual([]);
    // missing 态不可被当作「已解析空集」来 hard deny；isModelAllowed 恒 false 但语义不同
    expect(isModelAllowed(res, "api-proxy-gpt/gpt-5.2")).toBe(false);
  });

  it("有企业 entitlement 但交集为空 → state=resolved 且空集（hard deny 语义）", () => {
    const res = computeEffectiveModelSet({
      entitlement: entitlement(["api-proxy-gpt/gpt-5.2"]),
      grant: grant(["custom-x/mini"]),
      catalogActiveModelIds: ["api-proxy-gpt/gpt-5.2"],
    });
    expect(res.state).toBe("resolved");
    expect(res.allowedModelIds).toEqual([]);
  });

  it("revoked grant 视为无 active grant；默认不继承企业全集 → 空集", () => {
    const res = computeEffectiveModelSet({
      entitlement: entitlement(["api-proxy-gpt/gpt-5.2"]),
      grant: grant(["api-proxy-gpt/gpt-5.2"], "revoked"),
      catalogActiveModelIds: ["api-proxy-gpt/gpt-5.2"],
    });
    expect(res.state).toBe("resolved");
    expect(res.allowedModelIds).toEqual([]);
    expect(res.source).toBe("grant");
  });

  it("seatGrantInheritsEnterprise=true 且无 grant → 继承企业 ∩ 目录", () => {
    const res = computeEffectiveModelSet({
      entitlement: entitlement(["api-proxy-gpt/gpt-5.2", "custom-x/mini"]),
      grant: null,
      catalogActiveModelIds: ["api-proxy-gpt/gpt-5.2"],
      seatGrantInheritsEnterprise: true,
    });
    expect(res.state).toBe("resolved");
    expect(res.allowedModelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);
  });

  it("active 但 grantedModelIds 为空 → 视为无 grant，可继承企业全集", () => {
    const res = computeEffectiveModelSet({
      entitlement: entitlement(["api-proxy-gpt/gpt-5.2"]),
      grant: grant([]),
      catalogActiveModelIds: ["api-proxy-gpt/gpt-5.2"],
      seatGrantInheritsEnterprise: true,
    });
    expect(res.state).toBe("resolved");
    expect(res.allowedModelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);
  });
});

describe("computeEffectiveModelSet — 幂等/确定性", () => {
  it("交集幂等：两次计算结果一致", () => {
    fc.assert(
      fc.property(modelIds(), modelIds(), modelIds(), (ent, grnt, catalog) => {
        const input = {
          entitlement: entitlement(ent),
          grant: grant(grnt),
          catalogActiveModelIds: catalog,
        };
        const a = computeEffectiveModelSet(input);
        const b = computeEffectiveModelSet(input);
        expect(a.allowedModelIds).toEqual(b.allowedModelIds);
        expect(a.state).toBe(b.state);
      }),
    );
  });
});
