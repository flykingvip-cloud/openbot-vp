/**
 * Positive/negative evidence for app.ts controller allowlist expansions in
 * scripts/check-openbot-ui-boundaries.mjs.
 *
 * Runs the real check script against a temporary fixture tree via
 * OPENBOT_CHECK_REPO_ROOT — never rewrites live ui/src/ui/* sources.
 *
 * Adjacent non-allowlisted controller imports on a composition-root file with
 * allowed: [] (app-polling.ts) must still be rejected.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const scriptAbs = path.join(repoRoot, "scripts/check-openbot-ui-boundaries.mjs");

/** Minimal files the production ruleset reads under a fixture root. */
const RULE_FILES = [
  "ui/src/ui/app.ts",
  "ui/src/ui/app-render.ts",
  "ui/src/ui/app-lifecycle.ts",
  "ui/src/ui/app-host-adapters.ts",
  "ui/src/ui/app-polling.ts",
  "ui/src/ui/ports/employee/render-model-actions.ts",
  "ui/src/ui/app-settings.ts",
  "ui/src/ui/app-gateway.ts",
] as const;

const CLEAN_STUB = "// fixture stub — no controller imports\n";

let fixtureRoot: string | undefined;

afterEach(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

function writeFixture(appPollingBody: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "openbot-ui-boundaries-"));
  fixtureRoot = root;
  for (const rel of RULE_FILES) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, rel.endsWith("app-polling.ts") ? appPollingBody : CLEAN_STUB, "utf8");
  }
  return root;
}

function runUiBoundariesCheck(fixture: string) {
  return spawnSync(process.execPath, [scriptAbs], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENBOT_CHECK_REPO_ROOT: fixture,
    },
  });
}

describe("check-openbot-ui-boundaries controller allowlist", () => {
  it("passes a clean fixture (app-polling allowed: [])", () => {
    const fixture = writeFixture(CLEAN_STUB);
    const result = runUiBoundariesCheck(fixture);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("OpenBot UI boundary check passed");
  });

  it("rejects a non-allowlisted controller import on app-polling (allowed: [])", () => {
    const fixture = writeFixture(
      `import { loadAgents } from "./controllers/agents.ts";\n${CLEAN_STUB}`,
    );
    const result = runUiBoundariesCheck(fixture);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain("app-polling.ts");
    expect(output).toMatch(/unexpected direct controller import.*controllers\/agents\.ts/);
  });
});
