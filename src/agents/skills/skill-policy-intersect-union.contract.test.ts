import fs from "node:fs";
import path from "node:path";
import { DefaultCapabilityComposer } from "@openbot/collaboration-runtime";
import { describe, expect, it } from "vitest";
import { composeSkillPolicy } from "./skill-policy.js";

/**
 * F2 contract lock — INTERSECT ≠ UNION. Do not merge these semantics.
 *
 * Trust-boundary fork (intentional):
 * - `composeSkillPolicy` is the skill *execution* gate. Overlay / group
 *   `enabledSkills` INTERSECT. Narrower allow-list = fewer tools may run.
 * - `DefaultCapabilityComposer` is participation / prompt context only.
 *   personal ∪ group ∪ overlay UNION. Wider set = more skills may be mentioned.
 *
 * Merging them would either widen the exec gate (UNION leak) or shrink
 * participation prompts (INTERSECT hide). Keep both; assert they stay distinct.
 */
function unionTokens(...lists: readonly (readonly string[])[]): string[] {
  return [...new Set(lists.flat())].toSorted();
}

describe("F2 contract: composeSkillPolicy INTERSECT ≠ DefaultCapabilityComposer UNION", () => {
  it("overlapping allow-lists: INTERSECT is a strict subset of UNION", () => {
    const group = ["weather", "search", "notes"];
    const overlay = ["weather", "search"];
    const policy = composeSkillPolicy({
      groupProfile: { enabledSkills: group },
      overlay: { enabledSkills: overlay },
    });
    expect(policy.allow).toEqual(["weather", "search"]);
    expect(unionTokens(group, overlay)).toEqual(["notes", "search", "weather"]);
    expect(policy.allow).not.toEqual(unionTokens(group, overlay));
    expect(policy.allow?.every((name) => unionTokens(group, overlay).includes(name))).toBe(true);
  });

  it("disjoint allow-lists: INTERSECT is empty while UNION keeps both sides", async () => {
    const composer = new DefaultCapabilityComposer();
    const capabilitySet = await composer.composeCapabilities({
      botId: "bot-a",
      groupId: "g1",
      personalCapabilities: ["notes"],
      groupCapabilities: ["weather"],
      participationOverlay: [],
      policyFilters: [],
    });
    expect(new Set(capabilitySet.final)).toEqual(new Set(["notes", "weather"]));
    expect(new Set(capabilitySet.final)).toEqual(new Set(unionTokens(["notes"], ["weather"])));

    const gate = composeSkillPolicy({
      groupProfile: { enabledSkills: ["weather"] },
      overlay: { enabledSkills: ["notes"] },
    });
    expect(gate.allow).toEqual([]);
    expect(gate.allow).not.toEqual(capabilitySet.final);
  });

  it("participation overlay UNIONs in the composer and INTERSECTs in the skill gate", async () => {
    const composer = new DefaultCapabilityComposer();
    const capabilitySet = await composer.composeCapabilities({
      botId: "bot-b",
      groupId: "g2",
      personalCapabilities: [],
      groupCapabilities: ["weather", "search"],
      participationOverlay: ["notes"],
      policyFilters: [],
    });
    expect(new Set(capabilitySet.final)).toEqual(new Set(["weather", "search", "notes"]));

    const gate = composeSkillPolicy({
      groupProfile: { enabledSkills: ["weather", "search"] },
      overlay: { enabledSkills: ["notes"] },
    });
    expect(gate.allow).toEqual([]);
  });

  it("identical lists: INTERSECT equals UNION (sanity, not a merge)", () => {
    const skills = ["weather", "search"];
    const policy = composeSkillPolicy({
      groupProfile: { enabledSkills: skills },
      overlay: { enabledSkills: skills },
    });
    expect(policy.allow).toEqual(skills);
    expect(new Set(policy.allow)).toEqual(new Set(unionTokens(skills, skills)));
  });

  it("empty enabledSkills omit allow on the gate; composer.final [] is allow-none", async () => {
    expect(composeSkillPolicy({ groupProfile: { enabledSkills: [] } })).toEqual({ block: [] });
    expect(composeSkillPolicy({ overlay: { enabledSkills: [] } })).toEqual({ block: [] });
    const composer = new DefaultCapabilityComposer();
    const empty = await composer.composeCapabilities({
      botId: "bot-c",
      groupId: "g3",
      personalCapabilities: [],
      groupCapabilities: [],
      policyFilters: [],
    });
    expect(empty.final).toEqual([]);
    expect(composer.isCapabilityAllowed("weather", empty)).toBe(false);
  });

  it("documents the split in source and forbids merging composer into the exec gate", () => {
    const policySrc = fs.readFileSync(path.join(__dirname, "skill-policy.ts"), "utf8");
    const composerSrc = fs.readFileSync(
      path.join(
        __dirname,
        "../../../packages/collaboration-runtime/src/contracts/capability-composer.ts",
      ),
      "utf8",
    );
    expect(policySrc).toMatch(/INTERSECT other allow sources \(composer UNIONs participation\)/);
    expect(policySrc).not.toMatch(/new\s+DefaultCapabilityComposer\s*\(/);
    expect(composerSrc).toMatch(/\[\.\.\.personal,\s*\.\.\.group,\s*\.\.\.participation\]/);
  });
});
