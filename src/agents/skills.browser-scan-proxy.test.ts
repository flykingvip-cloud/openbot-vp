import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACK_STARTER } from "../gateway/capability-packs/starter-packs.js";
import { parseFrontmatter, resolveOpenClawMetadata } from "./skills/frontmatter.js";

const skillRoot = path.resolve(process.cwd(), "skills", "browser-scan-proxy");

describe("skills/browser-scan-proxy", () => {
  it("is a valid bundled skill on the starter pack", () => {
    const skillMd = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const frontmatter = parseFrontmatter(skillMd);
    expect(frontmatter.name).toBe("browser-scan-proxy");
    expect(String(frontmatter.description ?? "")).toMatch(/扫码登录/);
    expect(String(frontmatter.description ?? "")).toMatch(/user-guidance-protocol/);
    expect(resolveOpenClawMetadata(frontmatter)?.promptPriority).toBe(88);
    expect(resolveOpenClawMetadata(frontmatter)?.requires?.config).toEqual(["browser.enabled"]);
    expect(skillMd).toMatch(/profile="openclaw"/);
    expect(skillMd).toMatch(/RESTART_SCAN/);
    expect(PACK_STARTER.skills.some((skill) => skill.skillKey === "browser-scan-proxy")).toBe(true);
    expect(fs.existsSync(path.join(skillRoot, "references", "routing.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillRoot, "references", "browser-tool.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillRoot, "references", "examples.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillRoot, "README.md"))).toBe(false);
  });
});
