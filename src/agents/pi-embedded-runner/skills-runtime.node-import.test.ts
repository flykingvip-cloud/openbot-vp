/**
 * Gate C live notes (#562) could not import `resolveEmbeddedRunSkillEntries`
 * on Mac Node: `ERR_PACKAGE_PATH_NOT_EXPORTED` / no "exports" main on
 * `@earendil-works/pi-coding-agent`.
 *
 * Vitest's loader does not hit that Node CJS resolution. This test invokes the
 * loader the way that probe did (`node --require tsx/cjs`). It does not record
 * a Gate C or §5.2 loader pass.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("resolveEmbeddedRunSkillEntries Node import", () => {
  it("runs under node --require tsx/cjs without ERR_PACKAGE_PATH_NOT_EXPORTED", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "ob-skill-node-import-"));
    const script = `
      const { resolveEmbeddedRunSkillEntries } = require("./src/agents/pi-embedded-runner/skills-runtime.ts");
      const result = resolveEmbeddedRunSkillEntries({
        workspaceDir: ${JSON.stringify(workspaceDir)},
      });
      if (typeof result.shouldLoadSkillEntries !== "boolean" || !Array.isArray(result.skillEntries)) {
        throw new Error("unexpected resolveEmbeddedRunSkillEntries result");
      }
      process.stdout.write(JSON.stringify({
        ok: true,
        shouldLoadSkillEntries: result.shouldLoadSkillEntries,
        count: result.skillEntries.length,
      }));
    `;

    try {
      const stdout = execFileSync(process.execPath, ["--require", "tsx/cjs", "-e", script], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const parsed = JSON.parse(stdout) as {
        ok: boolean;
        shouldLoadSkillEntries: boolean;
        count: number;
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.shouldLoadSkillEntries).toBe(true);
      expect(parsed.count).toEqual(expect.any(Number));
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
