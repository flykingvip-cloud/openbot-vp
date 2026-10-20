import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCORE_WEIGHTS } from "./score.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const p2cDir = path.join(repoRoot, ".kiro/specs/execution-router-phase03-p2");

describe("Phase 1 I1 does not rewrite P2-C evidence", () => {
  it("leaves P2-C historical files unchanged when they exist", () => {
    if (!existsSync(p2cDir)) {
      expect(SCORE_WEIGHTS).toEqual({ classMatch: 0.5, tagOverlap: 0.3, riskAlign: 0.2 });
      return;
    }
    const diff = execFileSync("git", ["diff", "--", ".kiro/specs/execution-router-phase03-p2"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(diff).toBe("");
  });
});
