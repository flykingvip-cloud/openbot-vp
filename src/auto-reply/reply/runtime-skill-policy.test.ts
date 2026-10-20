import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCollaborationGroupProfileForRuntime = vi.fn();

vi.mock("../../gateway/collaboration-learning/group-runtime-profile.js", () => ({
  resolveCollaborationGroupProfileForRuntime: (...args: unknown[]) =>
    resolveCollaborationGroupProfileForRuntime(...args),
}));

const { resolveRuntimeSkillPolicy } = await import("./runtime-skill-policy.js");

describe("resolveRuntimeSkillPolicy", () => {
  beforeEach(() => {
    resolveCollaborationGroupProfileForRuntime.mockReset();
  });

  it("uses the disk group profile plus participation overlay", async () => {
    resolveCollaborationGroupProfileForRuntime.mockResolvedValue({
      groupId: "g1",
      enabledSkills: ["weather", "search"],
      blockedSkills: ["search"],
    });

    const policy = await resolveRuntimeSkillPolicy({
      groupId: "g1",
      sessionEntry: {
        sessionId: "s1",
        updatedAt: 1,
        collaborationParticipationOverlay: {
          participationId: "p1",
          botId: "bot-a",
          groupId: "g1",
          policyFilters: ["allow:weather"],
        },
      },
    });

    expect(resolveCollaborationGroupProfileForRuntime).toHaveBeenCalledWith({
      groupId: "g1",
      sessionProfile: undefined,
    });
    expect(policy.allow).toEqual(["weather"]);
    expect(policy.block).toEqual(["search"]);
  });

  it("skips disk resolve when no group id is present", async () => {
    const policy = await resolveRuntimeSkillPolicy({
      sessionEntry: { sessionId: "s1", updatedAt: 1 },
    });
    expect(resolveCollaborationGroupProfileForRuntime).not.toHaveBeenCalled();
    expect(policy).toEqual({ block: [] });
  });
});
