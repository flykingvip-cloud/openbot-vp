import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillSnapshot } from "../../agents/skills.js";

const hoisted = vi.hoisted(() => ({
  buildWorkspaceSkillSnapshot: vi.fn(
    (): SkillSnapshot => ({
      prompt: "workspace",
      skills: [{ name: "weather" }],
      resolvedSkills: [
        {
          name: "weather",
          description: "w",
          filePath: "/tmp/weather/SKILL.md",
          baseDir: "/tmp/weather",
          sourceInfo: {
            path: "/tmp/weather/SKILL.md",
            source: "test",
            scope: "project",
            origin: "top-level",
          },
          disableModelInvocation: false,
        },
        {
          name: "ob-asset-stale",
          description: "stale",
          filePath: "/tmp/stale/SKILL.md",
          baseDir: "/tmp/stale",
          sourceInfo: {
            path: "/tmp/stale/SKILL.md",
            source: "test",
            scope: "project",
            origin: "top-level",
          },
          disableModelInvocation: false,
        },
      ],
      version: 1,
    }),
  ),
  mergeSkillSnapshotWithExecutionBindings: vi.fn((snapshot: SkillSnapshot, agentId: string) => ({
    ...snapshot,
    agentId,
  })),
  getSkillsSnapshotVersion: vi.fn(() => 1),
  resolveAgentSkillsFilter: vi.fn(() => undefined),
  getRemoteSkillEligibility: vi.fn(() => ({})),
}));

vi.mock("../../agents/skills.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/skills.js")>();
  return {
    ...actual,
    buildWorkspaceSkillSnapshot: hoisted.buildWorkspaceSkillSnapshot,
  };
});

vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentSkillsFilter: () => hoisted.resolveAgentSkillsFilter(),
}));

vi.mock("../../agents/skills/refresh.js", () => ({
  getSkillsSnapshotVersion: () => hoisted.getSkillsSnapshotVersion(),
}));

vi.mock("../../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: () => hoisted.getRemoteSkillEligibility(),
}));

vi.mock("../../gateway/skill-execution-binding/index.js", () => ({
  mergeSkillSnapshotWithExecutionBindings: (snapshot: SkillSnapshot, agentId: string) =>
    hoisted.mergeSkillSnapshotWithExecutionBindings(snapshot, agentId),
}));

const { resolveCronSkillsSnapshot } = await import("./skills-snapshot.js");

describe("resolveCronSkillsSnapshot", () => {
  beforeEach(() => {
    hoisted.buildWorkspaceSkillSnapshot.mockClear();
    hoisted.mergeSkillSnapshotWithExecutionBindings.mockClear();
  });

  it("merges lifecycle bindings into refreshed workspace snapshots", () => {
    const snapshot = resolveCronSkillsSnapshot({
      workspaceDir: "/tmp/ws",
      config: {},
      agentId: "cron-bot",
      isFastTestEnv: false,
    });

    expect(hoisted.buildWorkspaceSkillSnapshot).toHaveBeenCalledOnce();
    expect(hoisted.mergeSkillSnapshotWithExecutionBindings).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "workspace" }),
      "cron-bot",
    );
    expect(snapshot).toMatchObject({ agentId: "cron-bot", prompt: "workspace" });
  });

  it("returns existing snapshot in fast test mode without filesystem scan", () => {
    const existing: SkillSnapshot = { prompt: "cached", skills: [] };
    const snapshot = resolveCronSkillsSnapshot({
      workspaceDir: "/tmp/ws",
      config: {},
      agentId: "cron-bot",
      existingSnapshot: existing,
      isFastTestEnv: true,
    });
    expect(snapshot).toBe(existing);
    expect(hoisted.mergeSkillSnapshotWithExecutionBindings).not.toHaveBeenCalled();
  });
});
