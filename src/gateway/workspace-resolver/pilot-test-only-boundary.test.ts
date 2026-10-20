import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Machine gate for the Batch 24 S26/S27 retirement premise.
 *
 * The retirement is only honest if `runEmployeeStewardCutoverPilot` stays test-only:
 * a production caller would run the provision + materialize (mkdir/copy) flow in
 * production. A doc `@internal` tag is not enough, so this test scans the whole
 * `src/**` tree and fails if ANY production file imports, re-exports, or calls the
 * pilot. It does not hardcode the current caller count, so newly added production
 * files are covered automatically.
 */

const SYMBOL = "runEmployeeStewardCutoverPilot";

const workspaceResolverDir = path.dirname(fileURLToPath(import.meta.url)); // src/gateway/workspace-resolver
const repoRoot = path.resolve(workspaceResolverDir, "../../..");
const srcDir = path.join(repoRoot, "src");

// The one module allowed to define (and thus name) the pilot.
const definingModule = path.resolve(workspaceResolverDir, "provision-steward-cutover.ts");
// The barrel that must NOT re-export the pilot.
const barrelIndex = path.join(workspaceResolverDir, "index.ts");

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const EXCLUDED_DIR_SEGMENTS = new Set([
  "node_modules",
  "__tests__",
  "__fixtures__",
  "__mocks__",
  "fixtures",
  "test-fixtures",
]);

function isTestOrFixtureFile(relPath: string, base: string): boolean {
  if (/\.(test|spec)\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(base)) {
    return true;
  }
  if (base.includes(".test-harness.")) {
    return true;
  }
  return relPath.split(path.sep).some((segment) => EXCLUDED_DIR_SEGMENTS.has(segment));
}

// Remove comments and string/template literals so a prose mention (e.g. a
// "moved to ..." note) is not mistaken for an import/re-export/call. A real
// reference (identifier) lives in code, never inside a comment or string.
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

function walkCodeFiles(dir: string, acc: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_SEGMENTS.has(entry.name)) {
        continue;
      }
      walkCodeFiles(path.join(dir, entry.name), acc);
    } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
      acc.push(path.join(dir, entry.name));
    }
  }
}

describe("Batch 24 test-only pilot boundary (machine gate)", () => {
  const allCodeFiles: string[] = [];
  walkCodeFiles(srcDir, allCodeFiles);

  it("scans the whole src tree (not a hardcoded caller count)", () => {
    // Guards new production files: the gate walks the tree dynamically.
    expect(allCodeFiles.length).toBeGreaterThan(100);
  });

  it("no production file imports, re-exports, or calls the test-only pilot", () => {
    const violations: string[] = [];
    for (const file of allCodeFiles) {
      const resolved = path.resolve(file);
      if (resolved === definingModule) {
        continue; // the defining module is allowed to name the pilot
      }
      const relPath = path.relative(repoRoot, file);
      if (isTestOrFixtureFile(relPath, path.basename(file))) {
        continue; // tests / harnesses / fixtures may use the pilot
      }
      const code = stripCommentsAndStrings(fs.readFileSync(file, "utf8"));
      if (code.includes(SYMBOL)) {
        violations.push(relPath);
      }
    }
    expect(
      violations,
      `${SYMBOL} is test-only; production code must not import/re-export/call it. Offending files: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("is not re-exported from the workspace-resolver barrel (index.ts)", () => {
    const raw = fs.readFileSync(barrelIndex, "utf8");
    expect(raw.includes(SYMBOL)).toBe(false);
  });
});
