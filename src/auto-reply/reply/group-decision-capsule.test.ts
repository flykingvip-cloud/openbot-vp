import type { Decision } from "@openbot/collaboration-core";
import { describe, expect, it, vi } from "vitest";
import { buildGroupDecisionCapsule } from "./group-decision-capsule.js";

vi.mock("../../gateway/collaboration-learning/shared.js", () => ({
  createWorkspaceCollaborationStores: () => ({
    objectStorage: {
      listObjects: vi.fn(async () => [
        {
          decisionId: "d1",
          groupId: "grp-1",
          title: "Launch date",
          options: [{ optionId: "o1", title: "July" }],
          selectedOption: "o1",
          rationale: "Customer deadline",
          status: "finalized",
          createdAt: 1,
          updatedAt: 2,
          finalizedAt: 2,
        } satisfies Decision,
      ]),
    },
  }),
}));

describe("buildGroupDecisionCapsule", () => {
  it("formats finalized decisions for active context", async () => {
    const text = await buildGroupDecisionCapsule({
      cfg: {},
      groupId: "grp-1",
    });
    expect(text).toContain("Launch date");
    expect(text).toContain("July");
    expect(text).toContain("Customer deadline");
  });

  it("returns empty string when no group scope", async () => {
    await expect(buildGroupDecisionCapsule({ cfg: {} })).resolves.toBe("");
  });
});
