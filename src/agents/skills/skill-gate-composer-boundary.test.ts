import fs from "node:fs";
import path from "node:path";
import { DefaultCapabilityComposer } from "@openbot/collaboration-runtime";
import { describe, expect, it } from "vitest";
import { composeSkillPolicy } from "./skill-policy.js";

/**
 * Track D / Mode A P1 lock:
 * Hot-path skill gate = composeSkillPolicy INTERSECT.
 * DefaultCapabilityComposer = UNION participation, prompt-only — never a third exec gate.
 */
describe("skill gate vs capability composer boundary", () => {
  it("INTERSECT overlay enabledSkills (composer would UNION)", () => {
    const policy = composeSkillPolicy({
      groupProfile: { enabledSkills: ["weather", "search", "notes"] },
      overlay: { enabledSkills: ["weather", "search"] },
    });
    expect(policy.allow).toEqual(["weather", "search"]);
    // Union of the same inputs would keep notes from group alone — INTERSECT drops it.
    expect(policy.allow).not.toContain("notes");
  });

  it("empty enabledSkills omit allow (≠ composer.final allow-none)", () => {
    expect(composeSkillPolicy({ groupProfile: { enabledSkills: [] } })).toEqual({ block: [] });
    expect(composeSkillPolicy({ overlay: { enabledSkills: [] } })).toEqual({ block: [] });
  });

  it("composer UNION participation remains distinct from skill gate INTERSECT", async () => {
    const composer = new DefaultCapabilityComposer();
    const capabilitySet = await composer.composeCapabilities({
      botId: "bot-a",
      groupId: "g1",
      personalCapabilities: ["notes"],
      groupCapabilities: ["weather"],
      policyFilters: [],
    });
    // Composer participation is union-shaped for prompt context.
    expect(new Set(capabilitySet.final)).toEqual(new Set(["notes", "weather"]));
    const gate = composeSkillPolicy({
      groupProfile: { enabledSkills: ["weather"] },
      overlay: { enabledSkills: ["notes"] },
    });
    // INTERSECT of weather ∩ notes = empty allow-list (none).
    expect(gate.allow).toEqual([]);
  });

  it("hot-path skill gate modules must not import DefaultCapabilityComposer", () => {
    const roots = [
      path.join(__dirname, "skill-policy.ts"),
      path.join(__dirname, "../../auto-reply/reply/runtime-skill-policy.ts"),
    ];
    for (const file of roots) {
      const src = fs.readFileSync(file, "utf8");
      // Comments may name the composer; forbid imports/instantiation only.
      expect(src).not.toMatch(/from ["'][^"']*collaboration-runtime[^"']*["']/);
      expect(src).not.toMatch(/import\s*\{[^}]*DefaultCapabilityComposer/);
      expect(src).not.toMatch(/new\s+DefaultCapabilityComposer\s*\(/);
      expect(src).toMatch(/composeSkillPolicy/);
    }
  });
});
