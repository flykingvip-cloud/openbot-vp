import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { SkillSnapshot } from "../skills.js";

const hoisted = vi.hoisted(() => ({
  loadWorkspaceSkillEntries: vi.fn(
    (_workspaceDir: string, _options?: { config?: OpenBotConfig }) => [] as unknown[],
  ),
  loadSkillExecutionBindingEntries: vi.fn((): unknown[] => []),
  mergeSkillEntriesWithBindings: vi.fn((base: unknown[], bound: unknown[]) => [...base, ...bound]),
  isLifecycleBindingSkillName: vi.fn((name: string) => name.startsWith("ob-asset-")),
}));

vi.mock("../skills.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skills.js")>();
  return {
    ...actual,
    loadWorkspaceSkillEntries: (workspaceDir: string, options?: { config?: OpenBotConfig }) =>
      hoisted.loadWorkspaceSkillEntries(workspaceDir, options),
  };
});

vi.mock("../../gateway/skill-execution-binding/index.js", () => ({
  loadSkillExecutionBindingEntries: () => hoisted.loadSkillExecutionBindingEntries(),
  mergeSkillEntriesWithBindings: (base: unknown[], bound: unknown[]) =>
    hoisted.mergeSkillEntriesWithBindings(base, bound),
  isLifecycleBindingSkillName: (name: string) => hoisted.isLifecycleBindingSkillName(name),
}));

const { resolveEmbeddedRunSkillEntries } = await import("./skills-runtime.js");

describe("resolveEmbeddedRunSkillEntries", () => {
  beforeEach(() => {
    hoisted.loadWorkspaceSkillEntries.mockReset();
    hoisted.loadWorkspaceSkillEntries.mockReturnValue([]);
    hoisted.loadSkillExecutionBindingEntries.mockReset();
    hoisted.loadSkillExecutionBindingEntries.mockReturnValue([]);
    hoisted.mergeSkillEntriesWithBindings.mockClear();
  });

  it("loads skill entries with config when no resolved snapshot skills exist", () => {
    const config: OpenBotConfig = {
      plugins: {
        entries: {
          diffs: { enabled: true },
        },
      },
    };

    const result = resolveEmbeddedRunSkillEntries({
      workspaceDir: "/tmp/workspace",
      config,
      skillsSnapshot: {
        prompt: "skills prompt",
        skills: [],
      },
    });

    expect(result.shouldLoadSkillEntries).toBe(true);
    expect(hoisted.loadWorkspaceSkillEntries).toHaveBeenCalledTimes(1);
    expect(hoisted.loadWorkspaceSkillEntries).toHaveBeenCalledWith("/tmp/workspace", { config });
  });

  it("merges lifecycle bindings when snapshot has resolvedSkills (cron/session freeze)", () => {
    const snapshot: SkillSnapshot = {
      prompt: "skills prompt",
      skills: [{ name: "diffs" }],
      resolvedSkills: [
        {
          name: "diffs",
          description: "d",
          filePath: "/x/diffs/SKILL.md",
          baseDir: "/x/diffs",
          sourceInfo: {
            path: "/x/diffs/SKILL.md",
            source: "test",
            scope: "project",
            origin: "top-level",
          },
          disableModelInvocation: false,
        },
        {
          name: "ob-asset-skill_old",
          description: "stale lifecycle",
          filePath: "/x/old/SKILL.md",
          baseDir: "/x/old",
          sourceInfo: {
            path: "/x/old/SKILL.md",
            source: "test",
            scope: "project",
            origin: "top-level",
          },
          disableModelInvocation: false,
        },
      ],
    };
    hoisted.loadSkillExecutionBindingEntries.mockReturnValue([
      {
        skill: {
          name: "ob-asset-skill_new",
          description: "live",
          filePath: "/b/SKILL.md",
          baseDir: "/b",
          sourceInfo: {
            path: "/b/SKILL.md",
            source: "binding",
            scope: "project",
            origin: "top-level",
          },
          disableModelInvocation: false,
        },
        frontmatter: {},
      },
    ] as unknown[]);

    const result = resolveEmbeddedRunSkillEntries({
      workspaceDir: "/tmp/workspace",
      config: {},
      skillsSnapshot: snapshot,
      agentId: "robot-a",
    });

    expect(result.shouldLoadSkillEntries).toBe(true);
    expect(result.preferLiveEntries).toBe(true);
    expect(hoisted.loadWorkspaceSkillEntries).not.toHaveBeenCalled();
    expect(hoisted.loadSkillExecutionBindingEntries).toHaveBeenCalled();
    // Stale lifecycle stripped, live binding merged.
    expect(hoisted.mergeSkillEntriesWithBindings).toHaveBeenCalled();
    // Projection-only: bindings merge into the same SkillEntry[] for one runner
    // (not a second execution chain / parallel delivery path).
    expect(hoisted.mergeSkillEntriesWithBindings.mock.calls).toHaveLength(1);
    const baseArg = hoisted.mergeSkillEntriesWithBindings.mock.calls[0]?.[0] as Array<{
      skill: { name: string };
    }>;
    expect(baseArg.map((e) => e.skill.name)).toEqual(["diffs"]);
  });

  it("drops snapshot-blocked skills after merging live bindings", () => {
    hoisted.loadSkillExecutionBindingEntries.mockReturnValue([
      {
        skill: {
          name: "search",
          description: "blocked live",
          filePath: "/b/SKILL.md",
          baseDir: "/b",
          sourceInfo: {
            path: "/b/SKILL.md",
            source: "binding",
            scope: "project",
            origin: "top-level",
          },
          disableModelInvocation: false,
        },
        frontmatter: {},
      },
    ] as unknown[]);

    const result = resolveEmbeddedRunSkillEntries({
      workspaceDir: "/tmp/workspace",
      agentId: "robot-a",
      skillsSnapshot: {
        prompt: "skills prompt",
        skills: [{ name: "diffs" }],
        skillBlocklist: ["search"],
        resolvedSkills: [
          {
            name: "diffs",
            description: "d",
            filePath: "/x/diffs/SKILL.md",
            baseDir: "/x/diffs",
            sourceInfo: {
              path: "/x/diffs/SKILL.md",
              source: "test",
              scope: "project",
              origin: "top-level",
            },
            disableModelInvocation: false,
          },
        ],
      },
    });

    expect(result.skillEntries.map((entry) => entry.skill.name)).toEqual(["diffs"]);
  });

  it("accepts optional agentId without requiring binding files", () => {
    const result = resolveEmbeddedRunSkillEntries({
      workspaceDir: "/tmp/workspace",
      agentId: "robot-alpha",
    });
    expect(result.shouldLoadSkillEntries).toBe(true);
    expect(result.preferLiveEntries).toBe(true);
    expect(hoisted.loadWorkspaceSkillEntries).toHaveBeenCalledWith("/tmp/workspace", {
      config: undefined,
    });
  });

  it("does not invent always:true when mapping snapshot skills to SkillEntry", () => {
    const result = resolveEmbeddedRunSkillEntries({
      workspaceDir: "/tmp/workspace",
      skillsSnapshot: {
        prompt: "skills prompt",
        skills: [{ name: "diffs" }],
        resolvedSkills: [
          {
            name: "diffs",
            description: "d",
            filePath: "/x/diffs/SKILL.md",
            baseDir: "/x/diffs",
            sourceInfo: {
              path: "/x/diffs/SKILL.md",
              source: "test",
              scope: "project",
              origin: "top-level",
            },
            disableModelInvocation: false,
          },
        ],
      },
    });
    const entry = result.skillEntries.find((e) => e.skill.name === "diffs");
    expect(entry?.metadata?.always).not.toBe(true);
  });
});
