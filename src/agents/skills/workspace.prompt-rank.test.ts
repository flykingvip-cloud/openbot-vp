import { describe, expect, it } from "vitest";
import type { SkillEntry } from "./types.js";
import {
  DEFAULT_MAX_ALWAYS_SKILLS_IN_PROMPT,
  DEFAULT_MAX_SKILLS_IN_PROMPT,
  DEFAULT_MAX_SKILLS_PROMPT_CHARS,
  demoteExcessAlwaysSkills,
  rankSkillEntriesForPrompt,
} from "./workspace.js";

function entry(name: string, metadata?: SkillEntry["metadata"]): SkillEntry {
  return {
    skill: {
      name,
      description: `${name} skill`,
      filePath: `/tmp/${name}/SKILL.md`,
      baseDir: `/tmp/${name}`,
      sourceInfo: {
        path: `/tmp/${name}/SKILL.md`,
        source: "openclaw-bundled",
        scope: "project",
        origin: "top-level",
      },
      disableModelInvocation: false,
    },
    frontmatter: {},
    metadata,
  };
}

describe("rankSkillEntriesForPrompt", () => {
  it("keeps assigned and high-priority skills ahead of alphabetical leftovers", () => {
    const ranked = rankSkillEntriesForPrompt(
      [
        entry("weather"),
        entry("web-research", { promptPriority: 90 }),
        entry("1password"),
        entry("deep-research"),
      ],
      ["deep-research"],
    );
    expect(ranked.map((row) => row.skill.name)).toEqual([
      "deep-research",
      "web-research",
      "1password",
      "weather",
    ]);
  });

  it("lifts turn-prefer skills ahead of alphabetical leftovers", () => {
    const ranked = rankSkillEntriesForPrompt(
      [entry("weather"), entry("wechat-official-account"), entry("1password")],
      ["wechat-official-account"],
    );
    expect(ranked.map((row) => row.skill.name)[0]).toBe("wechat-official-account");
  });

  it("demotes always skills beyond the MainPath cap so they lose the always boost", () => {
    const ranked = rankSkillEntriesForPrompt([
      entry("a-always", { always: true }),
      entry("b-always", { always: true }),
      entry("c-always", { always: true }),
      entry("d-always", { always: true }),
      entry("zebra"),
    ]);
    const alwaysNames = ranked.filter((row) => row.metadata?.always).map((row) => row.skill.name);
    expect(alwaysNames).toHaveLength(DEFAULT_MAX_ALWAYS_SKILLS_IN_PROMPT);
    expect(ranked.find((row) => row.skill.name === "d-always")?.metadata?.always).toBe(false);
    expect(ranked.map((row) => row.skill.name).slice(0, 3)).toEqual([
      "a-always",
      "b-always",
      "c-always",
    ]);
  });

  it("exposes thinner default skills prompt budgets for MainPath", () => {
    expect(DEFAULT_MAX_SKILLS_IN_PROMPT).toBe(48);
    expect(DEFAULT_MAX_SKILLS_PROMPT_CHARS).toBe(16_000);
    expect(DEFAULT_MAX_ALWAYS_SKILLS_IN_PROMPT).toBe(3);
  });
});

describe("demoteExcessAlwaysSkills", () => {
  it("keeps only the first N always flags in ranked order", () => {
    const out = demoteExcessAlwaysSkills(
      [
        entry("one", { always: true }),
        entry("two", { always: true }),
        entry("three", { always: true }),
      ],
      1,
    );
    expect(out.map((row) => row.metadata?.always)).toEqual([true, false, false]);
  });
});
