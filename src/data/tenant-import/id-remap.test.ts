import { describe, expect, it } from "vitest";
import { buildIdRemapPlan, resolveAgentId } from "./id-remap.js";

function counter(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("resolveAgentId", () => {
  it("keeps the semantic id when free", () => {
    expect(resolveAgentId("main", new Set())).toBe("main");
  });

  it("suffixes -imported on collision, then dedupes with -N", () => {
    expect(resolveAgentId("main", new Set(["main"]))).toBe("main-imported");
    expect(resolveAgentId("main", new Set(["main", "main-imported"]))).toBe("main-imported-2");
    expect(resolveAgentId("main", new Set(["main", "main-imported", "main-imported-2"]))).toBe(
      "main-imported-3",
    );
  });
});

describe("buildIdRemapPlan", () => {
  it("forces the target tenantId regardless of source", () => {
    const plan = buildIdRemapPlan({ targetTenantId: "acme", users: [], newId: counter() });
    expect(plan.tenantId).toBe("acme");
  });

  it("merges users by email when they already exist, else mints new ids (OQ-3 A)", () => {
    const plan = buildIdRemapPlan({
      targetTenantId: "acme",
      users: [
        { sourceUserId: "u-local-1", email: "Alice@Acme.com" },
        { sourceUserId: "u-local-2", email: "bob@acme.com" },
      ],
      existingUsersByEmail: { "alice@acme.com": "u-existing-alice" },
      newId: counter(),
    });
    expect(plan.users["u-local-1"]).toEqual({ targetUserId: "u-existing-alice", merged: true });
    expect(plan.users["u-local-2"]).toEqual({ targetUserId: "id-1", merged: false });
  });

  it("mints new uuids for seats, groups, knowledge bases, and identities", () => {
    const plan = buildIdRemapPlan({
      targetTenantId: "acme",
      users: [],
      seatIds: ["s1"],
      groupIds: ["g1"],
      knowledgeBaseIds: ["kb1"],
      identityIds: ["idn1"],
      newId: counter(),
    });
    expect(plan.seats.s1).toBe("id-1");
    expect(plan.groups.g1).toBe("id-2");
    expect(plan.knowledgeBases.kb1).toBe("id-3");
    expect(plan.identities.idn1).toBe("id-4");
  });

  it("keeps semantic agent ids and resolves collisions against existing target agents", () => {
    const plan = buildIdRemapPlan({
      targetTenantId: "acme",
      users: [],
      agentIds: ["main", "sales", "main"], // duplicate source ignored
      existingAgentIds: ["main"],
      newId: counter(),
    });
    expect(plan.agents.main).toBe("main-imported"); // collided with existing target "main"
    expect(plan.agents.sales).toBe("sales"); // free, kept semantic
  });
});
