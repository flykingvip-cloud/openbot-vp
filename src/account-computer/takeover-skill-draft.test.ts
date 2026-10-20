import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-takeover-skill-draft-${Date.now()}`);
vi.mock("../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const { persistTakeoverSiteSkillDraft, DESKTOP_TAKEOVER_SITEHOST_SKILL_LANDING } =
  await import("./takeover-skill-draft.js");
const { getPersonalSkillAssetDetail, getSkillRuntimeDefinitionForBinding } =
  await import("../gateway/skill-lifecycle-store.js");

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("persistTakeoverSiteSkillDraft", () => {
  beforeEach(cleanStore);
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exports landing id", () => {
    expect(DESKTOP_TAKEOVER_SITEHOST_SKILL_LANDING).toBe("DESKTOP_TAKEOVER_SITEHOST_SKILL_M1");
  });

  it("saves lifecycle=draft with contextId and never approved/published", () => {
    const { skillId } = persistTakeoverSiteSkillDraft(
      {
        siteHost: "Vendor.Example",
        title: "Takeover lesson · vendor.example",
        lesson: "Human resolved a user preempt on vendor.example and handed control back.",
        capabilities: ["desktop.takeover", "desktop.hand_back"],
      },
      { ownerUserId: "user-1", sourceAgentId: "agent-a" },
    );
    expect(skillId).toBeTruthy();
    const detail = getPersonalSkillAssetDetail(skillId);
    expect(detail.lifecycle).toBe("draft");
    expect(detail.profile.name).toContain("vendor.example");
    expect(detail.profile.summary).toContain("vendor.example");
    expect(detail.profile.visibility).toBe("private");
    const bound = getSkillRuntimeDefinitionForBinding(skillId);
    expect(bound.lifecycle).toBe("draft");
    expect(bound.runtimeDefinition.prompts?.[0]).toContain("vendor.example");
    expect(bound.runtimeDefinition.tools).toEqual(
      expect.arrayContaining(["desktop.takeover", "desktop.hand_back"]),
    );
  });

  it("rejects empty siteHost", () => {
    expect(() =>
      persistTakeoverSiteSkillDraft({
        siteHost: "  ",
        title: "x",
        lesson: "y",
        capabilities: [],
      }),
    ).toThrow(/siteHost/);
  });
});
