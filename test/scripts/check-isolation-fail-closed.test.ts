/**
 * Positive/negative evidence for bareSeatAllowlist exceptions in
 * scripts/check-isolation-fail-closed.mjs.
 *
 * Runs the real check script against a temporary fixture tree via
 * OPENBOT_CHECK_REPO_ROOT — never creates/deletes probes under the live
 * src/gateway/ worktree.
 *
 * Preserves the seat-tenant-index allowlist exception only if adjacent
 * non-allowlisted bare loadEnterpriseSeatAssetsStore() calls are still rejected.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const scriptAbs = path.join(repoRoot, "scripts/check-isolation-fail-closed.mjs");

const BARE_CALL = [
  'import { loadEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";',
  "void loadEnterpriseSeatAssetsStore();",
  "",
].join("\n");

let fixtureRoot: string | undefined;

afterEach(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

function writeGatewayFile(root: string, relUnderGateway: string, body: string) {
  const abs = path.join(root, "src/gateway", relUnderGateway);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
}

function makeFixture(writeProbe: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), "openbot-isolation-fc-"));
  fixtureRoot = root;
  // Allowlisted path with a bare call — must still pass.
  writeGatewayFile(root, "seat-tenant-index.ts", BARE_CALL);
  if (writeProbe) {
    writeGatewayFile(root, "__isolation_bare_seat_negative_probe__.ts", BARE_CALL);
  }
  return root;
}

function runIsolationCheck(fixture: string) {
  return spawnSync(process.execPath, [scriptAbs], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENBOT_CHECK_REPO_ROOT: fixture,
    },
  });
}

describe("check-isolation-fail-closed bareSeatAllowlist", () => {
  it("passes when only allowlisted seat-tenant-index uses a bare seat load", () => {
    const fixture = makeFixture(false);
    const result = runIsolationCheck(fixture);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("isolation fail-closed guard: ok");
  });

  it("rejects bare loadEnterpriseSeatAssetsStore() outside the allowlist (adjacent path)", () => {
    const fixture = makeFixture(true);
    const result = runIsolationCheck(fixture);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain("__isolation_bare_seat_negative_probe__.ts");
    expect(output).toMatch(/bare loadEnterpriseSeatAssetsStore/);
  });
});
