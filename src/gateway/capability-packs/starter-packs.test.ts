import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEW_TENANT_PACK_IDS,
  PACK_STARTER,
  PACK_CN_OFFICE,
  PACK_CHANNELS,
  PACK_LOCAL_DEV,
  PACK_PLATFORM_OPS,
  buildOfficialManifestId,
  findPackIdsForSkillKey,
  resolveAutoEntitlePackIds,
  resolvePackInstallSkillKeys,
  skillKeysForPackIds,
} from "./starter-packs.js";

describe("capability starter packs", () => {
  it("trial auto-entitles starter + cn-office", () => {
    expect(resolveAutoEntitlePackIds("trial")).toEqual(["starter", "cn-office"]);
    expect(DEFAULT_NEW_TENANT_PACK_IDS).toEqual(["starter", "cn-office"]);
  });

  it("business auto-entitles starter + cn-office", () => {
    expect(resolveAutoEntitlePackIds("business")).toEqual(["starter", "cn-office"]);
  });

  it("does not auto-entitle channels / local-dev / platform-ops", () => {
    const ids = resolveAutoEntitlePackIds("trial");
    expect(ids).not.toContain("channels");
    expect(ids).not.toContain("local-dev");
    expect(ids).not.toContain("platform-ops");
  });

  it("maps skill keys to packs (A/B/C)", () => {
    expect(findPackIdsForSkillKey("summarize")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("canvas")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("json-canvas")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("user-guidance-protocol")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("configure-external-api-source")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("openai-whisper-api")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("wechat-article")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("wechat-official-credential")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("finance-research")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("web-research")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("browser-scan-proxy")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("agent-reach")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("openbot-platform-ops")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("openbot-docs")).toEqual(["starter"]);
    expect(findPackIdsForSkillKey("feishu-integration")).toEqual(["cn-office"]);
    expect(findPackIdsForSkillKey("coding-agent")).toEqual(["cn-office"]);
    expect(findPackIdsForSkillKey("github")).toEqual(["channels"]);
    expect(findPackIdsForSkillKey("xurl")).toEqual(["channels"]);
    expect(findPackIdsForSkillKey("cursor-canvas")).toEqual(["local-dev"]);
    expect(findPackIdsForSkillKey("openai-whisper")).toEqual(["local-dev"]);
    expect(findPackIdsForSkillKey("trial-sales-conversion")).toEqual(["platform-ops"]);
    expect(findPackIdsForSkillKey("unknown-skill")).toEqual([]);
  });

  it("builds skill key set from pack ids", () => {
    const keys = skillKeysForPackIds(["starter"]);
    expect(keys.has("summarize")).toBe(true);
    expect(keys.has("meeting-notes-specialist")).toBe(true);
    expect(keys.has("finance-research")).toBe(true);
    expect(keys.has("web-research")).toBe(true);
    expect(keys.has("browser-scan-proxy")).toBe(true);
    expect(keys.has("wechat-official-credential")).toBe(true);
    expect(keys.has("web-search")).toBe(false);
    expect(keys.has("ppt-generator")).toBe(false);
    expect(keys.has("douyin-marketing")).toBe(false);
  });

  it("uses stable official manifest ids", () => {
    expect(buildOfficialManifestId("summarize")).toBe("urn:openbot:skill:summarize@1.0.0");
  });

  it("enforces A/B/C visibility policy", () => {
    expect(PACK_STARTER.employeeVisibilityMode).toBe("direct_employee_visible");
    expect(PACK_STARTER.autoEntitlePlans).toEqual(["*"]);
    expect(PACK_CN_OFFICE.employeeVisibilityMode).toBe("enterprise_review_required");
    expect(PACK_CHANNELS.employeeVisibilityMode).toBe("enterprise_only");
    expect(PACK_CHANNELS.autoEntitlePlans).toEqual([]);
    expect(PACK_LOCAL_DEV.employeeVisibilityMode).toBe("enterprise_only");
    expect(PACK_PLATFORM_OPS.employeeVisibilityMode).toBe("enterprise_only");
  });

  it("starter skills all have on-disk SKILL.md (no synthetic ghosts)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const skill of PACK_STARTER.skills) {
      const skillMd = path.join(process.cwd(), "skills", skill.skillKey, "SKILL.md");
      expect(fs.existsSync(skillMd), `${skill.skillKey} missing SKILL.md`).toBe(true);
    }
  });

  it("installs a starter recipe by capability set", () => {
    const keys = resolvePackInstallSkillKeys({ packId: "starter", recipeId: "meeting-followup" });
    expect(keys).toContain("meeting-notes-specialist");
    expect(keys).toContain("summarize");
    expect(keys).not.toContain("weather");
    expect(
      resolvePackInstallSkillKeys({ packId: "starter", capability: "speech.transcribe" }),
    ).toEqual(["openai-whisper-api"]);
    expect(resolvePackInstallSkillKeys({ packId: "starter", recipeId: "web-research" })).toEqual(
      expect.arrayContaining(["web-research", "agent-reach"]),
    );
    expect(
      resolvePackInstallSkillKeys({ packId: "starter", recipeId: "console-scan-proxy" }),
    ).toEqual(["browser-scan-proxy"]);
    expect(
      resolvePackInstallSkillKeys({ packId: "starter", recipeId: "wechat-oa-credential" }),
    ).toEqual(expect.arrayContaining(["wechat-official-credential", "browser-scan-proxy"]));
  });
});
