// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RetrievalContext } from "./types.js";
import {
  isKnowledgeBaseVisible,
  resolveAccessibleKnowledgeBases,
  type VisibilityKnowledgeBase,
} from "./visibility-resolver.js";

function ctx(over: Partial<RetrievalContext>): RetrievalContext {
  return { userId: null, seatId: null, tenantId: null, ...over };
}

const privateKb: VisibilityKnowledgeBase = {
  id: "kb_private",
  visibility: "private",
  ownerId: "user-1",
  tenantId: null,
};
const teamKb: VisibilityKnowledgeBase = {
  id: "kb_team",
  visibility: "team",
  ownerId: "user-1",
  tenantId: "tenant-a",
};
const enterpriseKb: VisibilityKnowledgeBase = {
  id: "kb_ent",
  visibility: "enterprise",
  ownerId: "user-9",
  tenantId: "tenant-a",
};

describe("visibility-resolver", () => {
  it("private knowledge base is visible only to its owner", () => {
    expect(isKnowledgeBaseVisible(ctx({ userId: "user-1" }), privateKb)).toBe(true);
    expect(isKnowledgeBaseVisible(ctx({ userId: "user-2" }), privateKb)).toBe(false);
    expect(isKnowledgeBaseVisible(ctx({ userId: null }), privateKb)).toBe(false);
  });

  it("team/enterprise knowledge base is visible to same tenant only", () => {
    expect(isKnowledgeBaseVisible(ctx({ userId: "user-2", tenantId: "tenant-a" }), teamKb)).toBe(
      true,
    );
    expect(
      isKnowledgeBaseVisible(ctx({ userId: "user-2", tenantId: "tenant-a" }), enterpriseKb),
    ).toBe(true);
    expect(isKnowledgeBaseVisible(ctx({ userId: "user-2", tenantId: "tenant-b" }), teamKb)).toBe(
      false,
    );
    expect(isKnowledgeBaseVisible(ctx({ userId: "user-2", tenantId: null }), teamKb)).toBe(false);
  });

  it("tenant-less team knowledge base falls back to owner check", () => {
    const orphanTeam: VisibilityKnowledgeBase = {
      id: "kb_orphan",
      visibility: "team",
      ownerId: "user-1",
      tenantId: null,
    };
    expect(isKnowledgeBaseVisible(ctx({ userId: "user-1" }), orphanTeam)).toBe(true);
    expect(isKnowledgeBaseVisible(ctx({ userId: "user-2" }), orphanTeam)).toBe(false);
  });

  it("matches tenant ids despite incidental surrounding whitespace", () => {
    const paddedTeam: VisibilityKnowledgeBase = {
      id: "kb_padded",
      visibility: "team",
      ownerId: "user-1",
      tenantId: " tenant-a ",
    };
    expect(
      isKnowledgeBaseVisible(ctx({ userId: "user-2", tenantId: "tenant-a" }), paddedTeam),
    ).toBe(true);
    expect(
      isKnowledgeBaseVisible(ctx({ userId: "user-2", tenantId: " tenant-a" }), paddedTeam),
    ).toBe(true);
    // A blank tenant must never match a shared base.
    expect(isKnowledgeBaseVisible(ctx({ userId: "user-2", tenantId: "   " }), paddedTeam)).toBe(
      false,
    );
  });

  it("resolveAccessibleKnowledgeBases returns only authorized ids", () => {
    const candidates = [privateKb, teamKb, enterpriseKb];
    const owner = resolveAccessibleKnowledgeBases(
      ctx({ userId: "user-1", tenantId: "tenant-a" }),
      candidates,
    );
    expect(owner).toEqual(["kb_private", "kb_team", "kb_ent"]);

    const outsider = resolveAccessibleKnowledgeBases(
      ctx({ userId: "user-2", tenantId: "tenant-b" }),
      candidates,
    );
    expect(outsider).toEqual([]);
  });
});
