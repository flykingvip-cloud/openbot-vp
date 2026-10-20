import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mapSkillLocationForAccountSandbox,
  materializeSharedAccountSkillsMount,
  remapSkillsPromptLocationsForAccountSandbox,
  resolveSharedAccountMountDirs,
} from "./account-shared-mounts.js";

function writeSkill(root: string, name: string, body: string): void {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body, "utf8");
}

describe("account shared mounts", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("materializes managed ∪ bundled with managed preferred", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-shared-skills-"));
    roots.push(root);
    const bundled = path.join(root, "bundled");
    const managed = path.join(root, "managed");
    const dest = path.join(root, "dest");
    writeSkill(bundled, "cyber-ppt", "# bundled cyber-ppt\n");
    writeSkill(bundled, "only-bundled", "# only bundled\n");
    writeSkill(managed, "cyber-ppt", "# managed cyber-ppt\n");
    writeSkill(managed, "only-managed", "# only managed\n");

    const mounted = materializeSharedAccountSkillsMount({
      bundledSkillsDir: bundled,
      managedSkillsDir: managed,
      destDir: dest,
    });
    expect(mounted).toBe(dest);
    expect(fs.readFileSync(path.join(dest, "cyber-ppt", "SKILL.md"), "utf8")).toContain("managed");
    expect(fs.existsSync(path.join(dest, "only-bundled", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "only-managed", "SKILL.md"))).toBe(true);
  });

  it("maps skill locations onto /account/skills", () => {
    expect(
      mapSkillLocationForAccountSandbox({
        skillName: "cyber-ppt",
        filePath: "/Users/x/.openbot/skills/cyber-ppt/SKILL.md",
      }),
    ).toBe("/account/skills/cyber-ppt/SKILL.md");
    expect(
      remapSkillsPromptLocationsForAccountSandbox(
        `<available_skills>\n  <skill>\n    <name>cyber-ppt</name>\n    <location>~/.openbot/skills/cyber-ppt/SKILL.md</location>\n  </skill>\n  <skill>\n    <name>pptx</name>\n    <location>/app/skills/pptx/SKILL.md</location>\n  </skill>\n</available_skills>`,
      ),
    ).toContain("<location>/account/skills/cyber-ppt/SKILL.md</location>");
    expect(
      remapSkillsPromptLocationsForAccountSandbox(`<location>/app/skills/pptx/SKILL.md</location>`),
    ).toBe("<location>/account/skills/pptx/SKILL.md</location>");
  });

  it("resolveSharedAccountMountDirs always returns canvas", () => {
    const dirs = resolveSharedAccountMountDirs({ canvasHost: { root: "/tmp/canvas-host" } });
    expect(dirs.sharedCanvasDir).toContain("canvas-host");
  });
});
