import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACK_STARTER } from "../gateway/capability-packs/starter-packs.js";
import { parseFrontmatter, resolveOpenClawMetadata } from "./skills/frontmatter.js";

const skillRoot = path.resolve(process.cwd(), "skills", "wechat-official-credential");

describe("skills/wechat-official-credential", () => {
  it("is a valid bundled skill on the starter pack", () => {
    const skillMd = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const frontmatter = parseFrontmatter(skillMd);
    expect(frontmatter.name).toBe("wechat-official-credential");
    expect(String(frontmatter.description ?? "")).toMatch(/AppID/);
    expect(String(frontmatter.description ?? "")).toMatch(/AppSecret/);
    expect(String(frontmatter.description ?? "")).toMatch(/IP 白名单/);
    expect(String(frontmatter.description ?? "")).toMatch(/不要收 Token/);
    expect(resolveOpenClawMetadata(frontmatter)?.promptPriority).toBe(89);
    expect(resolveOpenClawMetadata(frontmatter)?.requires?.config).toEqual(["browser.enabled"]);
    expect(skillMd).toMatch(/SCAN_MP/);
    expect(skillMd).toMatch(/SCAN_DEV/);
    expect(
      PACK_STARTER.skills.some((skill) => skill.skillKey === "wechat-official-credential"),
    ).toBe(true);
    expect(fs.existsSync(path.join(skillRoot, "references", "routing.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillRoot, "references", "console-map.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillRoot, "README.md"))).toBe(false);
  });
});
