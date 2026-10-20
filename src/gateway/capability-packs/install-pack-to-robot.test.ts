import { describe, expect, it } from "vitest";
import { TEMPLATE_AUTO_SKILL_KEYS, resolveAutoInstallSkillKeys } from "./install-pack-to-robot.js";
import { PACK_STARTER } from "./starter-packs.js";

describe("resolveAutoInstallSkillKeys", () => {
  it("includes all starter skills for generic_worker", () => {
    const keys = resolveAutoInstallSkillKeys({ templateId: "generic_worker" });
    for (const skill of PACK_STARTER.skills) {
      expect(keys).toContain(skill.skillKey);
    }
  });

  it("adds sales template skills", () => {
    const keys = resolveAutoInstallSkillKeys({ templateId: "sales_assistant" });
    expect(keys).toContain("summarize");
    expect(keys).toContain("sales-coach");
    expect(keys).toContain("sales-engineer");
    expect(keys).toContain("feishu-integration");
  });

  it("adds contract template skills", () => {
    const keys = resolveAutoInstallSkillKeys({ templateId: "contract_reviewer" });
    expect(keys).toContain("meeting-notes-specialist");
    expect(keys).toContain("nano-pdf");
  });

  it("merges extra skill keys", () => {
    const keys = resolveAutoInstallSkillKeys({
      templateId: "generic_worker",
      extraSkillKeys: ["custom-from-position"],
    });
    expect(keys).toContain("custom-from-position");
  });

  it("template map is defined for all known templates", () => {
    expect(TEMPLATE_AUTO_SKILL_KEYS.generic_worker).toEqual([]);
    expect(TEMPLATE_AUTO_SKILL_KEYS.sales_assistant.length).toBeGreaterThan(0);
    expect(TEMPLATE_AUTO_SKILL_KEYS.contract_reviewer.length).toBeGreaterThan(0);
  });
});
