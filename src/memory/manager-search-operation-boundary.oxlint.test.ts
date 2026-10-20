import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("manager search operation-boundary import guard", () => {
  it("manager.ts does not import createV1OperationAuth", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src/memory/manager.ts"), "utf8");
    expect(source).not.toMatch(/createV1OperationAuth/);
    expect(source).toMatch(/scheduleAuthorizedSearchSync/);
  });

  it("passes eslint/no-restricted-imports on manager.ts", () => {
    const output = execFileSync(
      "pnpm",
      ["exec", "oxlint", "-c", ".oxlintrc.json", "src/memory/manager.ts"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(output).toContain("Finished");
  });
});
