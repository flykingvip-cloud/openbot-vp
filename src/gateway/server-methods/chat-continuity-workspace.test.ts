import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  primaryResult: null as string | null,
  checkpointCandidates: [] as string[],
}));

vi.mock("../checkpoint-store.js", () => ({
  resolveChatCheckpointWorkspaceDirsForClient: vi.fn(async () => state.checkpointCandidates),
}));

const { resolveContinuityWorkspaceDirForTurn } = await import("./chat-continuity-workspace.js");

describe("resolveContinuityWorkspaceDirForTurn", () => {
  afterEach(() => {
    state.primaryResult = null;
    state.checkpointCandidates = [];
  });

  it("falls back to tenant checkpoint workspace candidates when authorized cwd is denied", async () => {
    state.checkpointCandidates = ["/tenants/001/users/user-elle/OpenBot/workspace"];

    const resolved = await resolveContinuityWorkspaceDirForTurn({
      cfg: {},
      sessionKey: "agent:main:main",
      agentId: "main",
      client: {
        connect: {} as never,
        platformUserId: "user-elle",
        sessionEnterpriseId: "001",
      },
      resolvePrimaryWorkspaceDir: async () => null,
    });

    expect(resolved).toBe("/tenants/001/users/user-elle/OpenBot/workspace");
  });

  it("prefers authorized cwd when managed authorization succeeds", async () => {
    state.primaryResult = "/authorized/should-win";
    state.checkpointCandidates = ["/tenants/001/users/user-elle/OpenBot/workspace"];

    const resolved = await resolveContinuityWorkspaceDirForTurn({
      cfg: {},
      sessionKey: "agent:main:employee:user-elle",
      agentId: "main",
      client: { connect: {} as never },
      resolvePrimaryWorkspaceDir: async () => state.primaryResult,
    });

    expect(resolved).toBe("/authorized/should-win");
  });
});
