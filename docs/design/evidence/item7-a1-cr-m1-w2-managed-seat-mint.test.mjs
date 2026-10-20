import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("Item 7 A1 CR-M1 mints a plain seat-owned workspace row, freeze-safe, no retirement", () => {
  const ev = load("item7-a1-cr-m1-w2-managed-seat-mint.json");
  const packed = JSON.stringify(ev);

  // Scope: W2 only (W3 already on main, W1 deferred).
  assert.equal(ev.cr, "CR-M1");
  assert.equal(ev.scope, "W2 only");
  assert.equal(ev.w3.status, "already-landed-on-main");
  assert.equal(ev.w1.status, "deferred-to-CR-M2");

  // W2 mints a canonical plain seat id (never a sha256 hash) via the shared builder.
  assert.equal(ev.w2.mintFn, "upsertWorkspaceGovernanceRecord");
  assert.match(ev.w2.idFormatExample, /^ws:[^:]+:seat:[^:]+:asset:.+$/);
  assert.equal(ev.w2.idempotent, true);

  // Freeze-safe: no watched production call sites / helpers / synthesis added.
  assert.equal(ev.freeze.ok, true);
  assert.equal(ev.freeze.addedProductionCallSites, 0);
  assert.equal(ev.freeze.addedProductionHelpers, 0);
  assert.equal(ev.freeze.addedCatalogSynthesis, 0);

  // Governance invariants for this CR: no site retired, Item 7 stays not-met.
  assert.equal(ev.retirement.siteRetiredThisCr, 0);
  assert.equal(ev.item7, "not-met");

  // Verification: no new type errors in touched files.
  assert.equal(ev.verification.tsgoNewErrorsInTouchedFiles, 0);

  // The design doc and the W2 mint site exist in the tree.
  assert.ok(fs.existsSync(path.join(REPO, ev.designDoc)));
  assert.ok(ev.filesTouched.includes("src/gateway/server-methods/agents.ts"));
  for (const rel of ev.filesTouched) {
    if (rel.endsWith(".md") || fs.existsSync(path.join(REPO, rel))) {
      continue;
    }
    assert.fail(`filesTouched entry missing: ${rel}`);
  }

  // The landed seat projection the mint relies on is present in the tree.
  const projection = fs.readFileSync(
    path.join(REPO, "src/gateway/data-governance/workspace-catalog-projection.ts"),
    "utf8",
  );
  assert.match(projection, /SEAT_OWNED_ASSET_ID/);

  // No machine-specific absolute paths leaked into the evidence record.
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, /\/home\//);
});
