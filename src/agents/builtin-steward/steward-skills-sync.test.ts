import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureStewardRequiredSkillsSynced } from "./steward-skills-sync.js";

describe("ensureStewardRequiredSkillsSynced", () => {
  let tmpRoot = "";
  let bundledRoot = "";
  let workspaceDir = "";

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "steward-skills-sync-"));
    bundledRoot = path.join(tmpRoot, "bundled");
    workspaceDir = path.join(tmpRoot, "workspace");
    await fs.mkdir(path.join(bundledRoot, "user-guidance-protocol", "references"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(bundledRoot, "user-guidance-protocol", "SKILL.md"),
      "---\nname: user-guidance-protocol\ndescription: test\n---\n# ok\n",
      "utf-8",
    );
    await fs.mkdir(path.join(bundledRoot, "configure-external-api-source", "scripts"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(bundledRoot, "configure-external-api-source", "SKILL.md"),
      "---\nname: configure-external-api-source\ndescription: test\n---\n# ok\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(bundledRoot, "configure-external-api-source", "scripts", "probe-http-api.mjs"),
      "export const probe = true;\n",
      "utf-8",
    );
    await fs.mkdir(path.join(bundledRoot, "openbot-docs", "references"), { recursive: true });
    await fs.writeFile(
      path.join(bundledRoot, "openbot-docs", "SKILL.md"),
      "---\nname: openbot-docs\ndescription: test\n---\n# ok\n",
      "utf-8",
    );
    await fs.mkdir(path.join(bundledRoot, "personal-mail-assistant"), { recursive: true });
    await fs.writeFile(
      path.join(bundledRoot, "personal-mail-assistant", "SKILL.md"),
      "---\nname: personal-mail-assistant\ndescription: test\n---\n# ok\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(bundledRoot, "user-guidance-protocol", "references", "wechat-oa.yaml"),
      "scenario:\n  name: wechat_oa_setup\n",
      "utf-8",
    );
    // Unrelated bundled skill must not be copied.
    await fs.mkdir(path.join(bundledRoot, "other-skill"), { recursive: true });
    await fs.writeFile(
      path.join(bundledRoot, "other-skill", "SKILL.md"),
      "---\nname: other-skill\ndescription: x\n---\n",
      "utf-8",
    );
    // Existing workspace skill must be preserved.
    await fs.mkdir(path.join(workspaceDir, "skills", "keep-me"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "skills", "keep-me", "SKILL.md"),
      "---\nname: keep-me\ndescription: keep\n---\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("copies only steward-required skills with references into the workspace", async () => {
    const synced = await ensureStewardRequiredSkillsSynced({
      workspaceDir,
      bundledSkillsDir: bundledRoot,
    });
    expect(synced).toEqual([
      "configure-external-api-source",
      "user-guidance-protocol",
      "openbot-docs",
      "personal-mail-assistant",
    ]);
    await expect(
      fs.readFile(
        path.join(
          workspaceDir,
          "skills",
          "configure-external-api-source",
          "scripts",
          "probe-http-api.mjs",
        ),
        "utf-8",
      ),
    ).resolves.toContain("probe = true");
    await expect(
      fs.readFile(
        path.join(workspaceDir, "skills", "user-guidance-protocol", "references", "wechat-oa.yaml"),
        "utf-8",
      ),
    ).resolves.toContain("wechat_oa_setup");
    await expect(
      fs.access(path.join(workspaceDir, "skills", "keep-me", "SKILL.md")),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(workspaceDir, "skills", "other-skill"))).rejects.toThrow();
  });
});
