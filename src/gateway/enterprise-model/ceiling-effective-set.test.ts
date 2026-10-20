// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeEffectiveModelSet } from "../model-entitlement/effective-set.js";
import type { EnterpriseModelEntitlement, SeatModelGrant } from "../model-entitlement/types.js";

function entitlement(allowed: string[]): EnterpriseModelEntitlement {
  return { tenantId: "t1", allowedModelIds: allowed, updatedAt: "2026-01-01T00:00:00.000Z" };
}

function grant(granted: string[]): SeatModelGrant {
  return {
    tenantId: "t1",
    subjectType: "seat",
    subjectId: "s1",
    seatId: "s1",
    grantedModelIds: granted,
    status: "active",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeEffectiveModelSet — enterprise ceiling + BYOK", () => {
  it("merges subscription and tenant-owned into effective set when granted", () => {
    const res = computeEffectiveModelSet({
      entitlement: entitlement(["openai/gpt-4o"]),
      grant: grant(["openai/gpt-4o", "ent/abc/local-llama"]),
      catalogActiveModelIds: ["openai/gpt-4o"],
      tenantOwnedActiveModelIds: ["ent/abc/local-llama"],
    });
    expect(res.state).toBe("resolved");
    expect(res.allowedModelIds.toSorted()).toEqual(
      ["ent/abc/local-llama", "openai/gpt-4o"].toSorted(),
    );
  });

  it("allows BYOK-only tenants without subscription entitlement", () => {
    const res = computeEffectiveModelSet({
      entitlement: null,
      grant: grant(["ent/abc/local-llama"]),
      catalogActiveModelIds: [],
      tenantOwnedActiveModelIds: ["ent/abc/local-llama"],
    });
    expect(res.state).toBe("resolved");
    expect(res.allowedModelIds).toEqual(["ent/abc/local-llama"]);
  });

  it("hard-denies disabled/absent tenant-owned models", () => {
    const res = computeEffectiveModelSet({
      entitlement: entitlement(["openai/gpt-4o"]),
      grant: grant(["ent/abc/gone"]),
      catalogActiveModelIds: ["openai/gpt-4o"],
      tenantOwnedActiveModelIds: [],
    });
    expect(res.state).toBe("resolved");
    expect(res.allowedModelIds).toEqual([]);
  });

  it("rejects grants outside ceiling via empty intersection", () => {
    const res = computeEffectiveModelSet({
      entitlement: entitlement(["openai/gpt-4o"]),
      grant: grant(["other/not-allowed"]),
      catalogActiveModelIds: ["openai/gpt-4o", "other/not-allowed"],
      tenantOwnedActiveModelIds: ["ent/abc/local-llama"],
    });
    expect(res.allowedModelIds).toEqual([]);
  });
});
