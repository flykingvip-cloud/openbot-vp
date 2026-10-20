import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluatePhase0ExitGate } from "./memory-workspace-phase0-exit-gate.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

void test("engineering exit gate passes on this repo", () => {
  const result = evaluatePhase0ExitGate({ repoRoot: REPO_ROOT });
  assert.equal(
    result.engineeringGate.pass,
    true,
    JSON.stringify(result.engineeringGate.checks.filter((c) => !c.pass)),
  );
  assert.equal(result.phase0Accepted, true);
  assert.equal(result.governanceGate.pass, true);
  assert.ok(result.governanceGate.signOffMainSha?.startsWith("58ce58793") ?? result.phase0Accepted);
});

void test("fails when required evidence is missing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phase0-exit-gate-"));
  const result = evaluatePhase0ExitGate({ repoRoot: tmp });
  assert.equal(result.engineeringGate.pass, false);
  assert.ok(result.engineeringGate.checks.some((c) => c.id.startsWith("file:") && !c.pass));
});
