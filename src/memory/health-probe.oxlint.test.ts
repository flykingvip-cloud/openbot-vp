import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Windows runners expose pnpm as pnpm.cmd. spawnSync("pnpm") does not resolve that.
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const oxlintConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, ".oxlintrc.json"), "utf8")) as {
  overrides?: Array<{ files: string[]; rules: Record<string, unknown> }>;
};

describe("health-probe oxlint import guard", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes eslint/no-restricted-imports on health-probe.ts", () => {
    const output = execFileSync(
      pnpmBin,
      ["exec", "oxlint", "-c", ".oxlintrc.json", "src/memory/health-probe.ts"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(output).toContain("Finished");
  });

  it("fails when health-probe would import manager.js", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-oxlint-"));
    tempDirs.push(tmpDir);
    const badFile = path.join(tmpDir, "health-probe.ts");
    fs.writeFileSync(badFile, 'import { MemoryIndexManager } from "./manager.js";\n');
    const override = oxlintConfig.overrides?.find((entry) =>
      entry.files.includes("src/memory/health-probe.ts"),
    );
    expect(override).toBeDefined();
    const configPath = path.join(tmpDir, ".oxlintrc.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ...oxlintConfig,
        overrides: [{ files: ["health-probe.ts"], rules: override!.rules }],
      }),
    );
    expect(() =>
      execFileSync(pnpmBin, ["exec", "oxlint", "-c", configPath, badFile], {
        cwd: tmpDir,
        encoding: "utf8",
      }),
    ).toThrow();
  });
});
