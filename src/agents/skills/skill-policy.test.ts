import { DefaultCapabilityComposer } from "@openbot/collaboration-runtime";
import { describe, expect, it } from "vitest";
import {
  applySkillPolicyToAllowlist,
  applySkillPolicyToEntries,
  applySkillPolicyToFilter,
  composeSkillPolicy,
  isSkillNameAllowed,
  isToolAllowedBySkillPolicy,
  skillPolicyFromCapabilityFinal,
  skillPolicyFromSnapshot,
  UNRESTRICTED_SKILL_POLICY,
} from "./skill-policy.js";

describe("composeSkillPolicy", () => {
  it("stays unrestricted when enabledSkills are empty or omitted", () => {
    expect(composeSkillPolicy({ groupProfile: { enabledSkills: [], blockedSkills: [] } })).toEqual({
      block: [],
    });
    expect(composeSkillPolicy({})).toEqual({ block: [] });
  });

  it("treats non-empty enabledSkills as an allow-list and unions blockedSkills", () => {
    const policy = composeSkillPolicy({
      groupProfile: { enabledSkills: ["weather", "search"], blockedSkills: ["search"] },
      overlay: { enabledSkills: ["weather", "notes"], blockedSkills: ["notes"] },
    });
    expect(policy.allow).toEqual(["weather"]);
    expect(policy.block).toEqual(["search", "notes"]);
  });

  it("reads session overlay policyFilters (!skill / allow: / block:)", () => {
    const policy = composeSkillPolicy({
      groupProfile: { enabledSkills: ["weather", "search"] },
      overlay: { policyFilters: ["!search", "allow:weather"] },
    });
    expect(policy.allow).toEqual(["weather"]);
    expect(policy.block).toEqual(["search"]);
  });
});

describe("applySkillPolicyToFilter", () => {
  it("intersects an existing allow-list with group allow-list", () => {
    expect(
      applySkillPolicyToFilter(["weather", "exec"], { allow: ["weather"], block: [] }),
    ).toEqual(["weather"]);
  });

  it("leaves an unrestricted base filter alone when the group has no allow-list", () => {
    expect(applySkillPolicyToFilter(undefined, { block: ["search"] })).toBeUndefined();
  });
});

describe("isSkillNameAllowed / applySkillPolicyToEntries", () => {
  it("blocks names even when the catalog is otherwise unrestricted", () => {
    const policy = { block: ["search"] };
    expect(isSkillNameAllowed("search", policy)).toBe(false);
    expect(isSkillNameAllowed("weather", policy)).toBe(true);
    expect(
      applySkillPolicyToEntries(
        [{ skill: { name: "weather" } }, { skill: { name: "search" } }],
        policy,
      ).map((entry) => entry.skill.name),
    ).toEqual(["weather"]);
  });
});

describe("applySkillPolicyToAllowlist", () => {
  it("removes blocked tool names without tightening an unrestricted catalog", () => {
    expect(
      applySkillPolicyToAllowlist(["exec", "web_search", "read"], { block: ["web_search"] }),
    ).toEqual(["exec", "read"]);
  });

  it("intersects a non-empty allow-list then subtracts blocks", () => {
    expect(
      applySkillPolicyToAllowlist(["exec", "web_search", "read"], {
        allow: ["web_search", "read"],
        block: ["web_search"],
      }),
    ).toEqual(["read"]);
  });
});

describe("skillPolicyTokenMatchesToolName via allowlist", () => {
  const tools = [
    "exec",
    "web_search",
    "read",
    "ob_sk_search__web_search",
    "ob_sk_weather__web_search",
    "ob_sk_search__notes",
    "ob_sk_skill_abc__notes",
  ];

  it("maps search onto web_search and identity search/web_search tools", () => {
    expect(applySkillPolicyToAllowlist(tools, { block: ["search"] })).toEqual([
      "exec",
      "read",
      "ob_sk_skill_abc__notes",
    ]);
    expect(isSkillNameAllowed("web_search", { block: ["search"] })).toBe(false);
    expect(isSkillNameAllowed("ob_sk_search__web_search", { block: ["search"] })).toBe(false);
    expect(isSkillNameAllowed("ob_sk_search__notes", { block: ["search"] })).toBe(false);
    expect(isSkillNameAllowed("ob_sk_weather__web_search", { block: ["search"] })).toBe(false);
    expect(isSkillNameAllowed("exec", { block: ["search"] })).toBe(true);
  });

  it("maps exec onto exec identity tools but not web_search", () => {
    expect(
      applySkillPolicyToAllowlist(["exec", "web_search", "ob_sk_foo__exec", "read"], {
        block: ["exec"],
      }),
    ).toEqual(["web_search", "read"]);
    expect(isSkillNameAllowed("exec", { block: ["exec"] })).toBe(false);
    expect(isSkillNameAllowed("web_search", { block: ["exec"] })).toBe(true);
    expect(isSkillNameAllowed("ob_sk_foo__exec", { block: ["exec"] })).toBe(false);
  });

  it("blocks identity tools by folded skillId", () => {
    expect(isSkillNameAllowed("ob_sk_skill_abc__notes", { block: ["skill_abc"] })).toBe(false);
    expect(
      applySkillPolicyToAllowlist(["ob_sk_skill_abc__notes", "web_search"], {
        block: ["skill_abc"],
      }),
    ).toEqual(["web_search"]);
  });

  it("keeps identity tools under unrestricted personal-steward policy", () => {
    expect(applySkillPolicyToAllowlist(tools, { block: [] })).toEqual(tools);
    expect(applySkillPolicyToAllowlist(tools, UNRESTRICTED_SKILL_POLICY)).toEqual(tools);
    expect(isSkillNameAllowed("ob_sk_weather__web_search", { block: [] })).toBe(true);
    expect(isSkillNameAllowed("ob_sk_search__notes", UNRESTRICTED_SKILL_POLICY)).toBe(true);
  });
});

describe("skillPolicyFromSnapshot", () => {
  it("treats a stored empty skillFilter as allow-none", () => {
    expect(skillPolicyFromSnapshot({ skillFilter: [] })).toEqual({ allow: [], block: [] });
  });
});

describe("DefaultCapabilityComposer.final equivalent", () => {
  const registered = [
    "exec",
    "web_search",
    "read",
    "ob_sk_search__web_search",
    "ob_sk_weather__notes",
  ];

  it("lifts composer.final so a blocked search skill cannot keep web_search", async () => {
    const composer = new DefaultCapabilityComposer();
    const capabilitySet = await composer.composeCapabilities({
      botId: "bot-a",
      groupId: "g1",
      personalCapabilities: [],
      groupCapabilities: ["search", "weather"],
      policyFilters: ["block:search"],
    });
    expect(capabilitySet.final).toEqual(["weather"]);
    expect(composer.isCapabilityAllowed("search", capabilitySet)).toBe(false);
    expect(composer.isCapabilityAllowed("weather", capabilitySet)).toBe(true);

    const policy = skillPolicyFromCapabilityFinal({
      final: capabilitySet.final,
      block: ["search"],
    });
    expect(applySkillPolicyToAllowlist(registered, policy)).toEqual(["ob_sk_weather__notes"]);
    expect(isToolAllowedBySkillPolicy("web_search", policy)).toBe(false);
    expect(isToolAllowedBySkillPolicy("ob_sk_search__web_search", policy)).toBe(false);
    expect(isToolAllowedBySkillPolicy("ob_sk_weather__notes", policy)).toBe(true);
  });

  it("maps group blockedSkills=search onto the tools array without a mocked policy", () => {
    const policy = composeSkillPolicy({
      groupProfile: { blockedSkills: ["search"] },
    });
    expect(applySkillPolicyToAllowlist(registered, policy)).toEqual([
      "exec",
      "read",
      "ob_sk_weather__notes",
    ]);
    expect(isToolAllowedBySkillPolicy("web_search", policy)).toBe(false);
  });

  it("maps 搜索技能 onto web_search", () => {
    expect(
      applySkillPolicyToAllowlist(["exec", "web_search"], {
        block: ["搜索技能"],
      }),
    ).toEqual(["exec"]);
  });
});
