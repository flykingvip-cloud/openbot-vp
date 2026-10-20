import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyAuthorizedSqlitePath } from "./openbot-cogniweave-u1-item6-production-equivalent-drill.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const EVIDENCE = "memory-workspace-phase1b-item6-evidence.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const OP = "phase1b-item6-evidence-f495f7a6a1-20260820T041500Z";
const I4 = "openbot-data-governance-p4-later-i4-eval";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function readRepo(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), "utf8");
}

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function gitOut(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function evaluateItem6Access(input) {
  if (input.implementationUnlocked === true) {
    return { allow: false, reason: "implementation-still-locked" };
  }
  if (input.phase1bExecutionBlocked !== true) {
    return { allow: false, reason: "execution-not-blocked" };
  }
  if (input.write === true) {
    return { allow: false, reason: "production-write-forbidden", failClosed: true };
  }
  if (input.pathClass !== "production-candidate" && input.pathClass !== "resource-layout-shadow") {
    return { allow: false, reason: "identity-unproven", failClosed: true };
  }
  if (!input.requestedTenant || input.requestedTenant !== input.sqliteTenant) {
    return { allow: false, reason: "cross-tenant-denied", failClosed: true };
  }
  if (input.restoreHashMismatch === true) {
    return { allow: false, reason: "restore-failed", failClosed: true };
  }
  return { allow: true, mode: "read-only-shadow", productionWrites: 0 };
}

void test("item 6 evidence package stays preparation-only and not-met", () => {
  const evidence = load(EVIDENCE);
  const minima = load("memory-workspace-phase1b-unlock-minima-issued-receipt.json");
  const current = load("memory-workspace-phase1b-unlock-current.json");
  const u1 = load("openbot-cogniweave-u1-item6-production-equivalent-receipt.json");
  const drill = load("memory-workspace-phase1b-item6-cutover-drill-receipt.json");
  const packed = JSON.stringify(evidence);

  assert.equal(evidence.schema, "memory-workspace-phase1b-item6-evidence/v1");
  assert.equal(evidence.status, "evidence-preparation");
  assert.equal(evidence.item6, "not-met");
  assert.equal(evidence.item6Met, false);
  assert.equal(evidence.implementationUnlocked, false);
  assert.equal(evidence.implementationStarted, false);
  assert.equal(evidence.phase1bExecutionBlocked, true);
  assert.equal(evidence.deployAuthorized, false);
  assert.equal(evidence.wiredToProductionResolver, false);
  assert.equal(evidence.liveCutover, false);
  assert.equal(evidence.operationId, OP);
  assert.equal(evidence.minimaReceiptTip, MINIMA_TIP);
  assert.equal(evidence.item5ReviewTip, ITEM5_TIP);
  assert.equal(evidence.baselineSha, gitOut(["rev-parse", "origin/main"]));
  assert.equal(evidence.originMainSha, evidence.baselineSha);
  assert.equal(evidence.branchShaAtStart, evidence.baselineSha);
  assert.equal(evidence.priorOperationId, "phase1b-item6-evidence-a3305d2767-20260820T021600Z");
  assert.equal(evidence.productionSqliteWrite, false);
  assert.equal(evidence.schemaV2ProductionWrite, false);
  assert.equal(evidence.resolverModified, false);
  assert.equal(evidence.i4DirtyTreeUsed, false);
  assert.equal(evidence.reviewRequest, "Item 6 Evidence Preparation Review only");
  assert.equal(evidence.implementationRequestDraft.requestsImplementationUnlock, false);
  assert.equal(evidence.implementationRequestDraft.requestsItem6Met, false);
  assert.equal(evidence.productionEquivalentReadOnly.thisPackageMarksItem6Met, false);
  assert.equal(evidence.productionEquivalentReadOnly.phase1bItem6, "not-met");
  assert.equal(u1.item6Candidate, "met");
  assert.notEqual(evidence.item6, "met");
  assert.equal(drill.item6, "not-met");
  assert.equal(minima.unlock, "minima-issued");
  assert.equal(minima.minimaReceiptTip ?? MINIMA_TIP, MINIMA_TIP);
  assert.equal(current.minimaUnlock, "issued");
  assert.equal(current.fullUnlock, "not-issued");
  assert.equal(current.item6ImplementationUnlocked, false);
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, new RegExp(I4));
  assert.ok(evidence.explicitlyForbidden.includes("LIVE cutover"));
  assert.ok(
    evidence.explicitlyForbidden.includes(
      "marking production-equivalent verification as Item 6 met",
    ),
  );
});

void test("item 6 sqlite identity is explicit and fail-closed", () => {
  const evidence = load(EVIDENCE);
  const identities = evidence.sqlitePathIdentities
    .map((row) => row.id)
    .toSorted((left, right) => left.localeCompare(right));
  assert.deepEqual(identities, ["operator-authorized-env", "resource-layout"]);
  assert.equal(
    evidence.sqlitePathIdentities.find((row) => row.id === "resource-layout").pattern,
    "{stateDir}/memory/resource-{resourceId}.sqlite",
  );
  assert.equal(evidence.identityRules.forbidHostSearch, true);
  assert.equal(evidence.identityRules.failClosedOnUnknownIdentity, true);
  assert.equal(evidence.backupDesign.hashMismatch, "fail-closed");
  assert.equal(evidence.rollbackDesign.productionWriteBack, "forbidden");
  assert.equal(evidence.fencingDesign.productionWriterEnabled, false);
  assert.equal(evidence.shadowMode.writesProductionSqlite, false);
  assert.equal(evidence.dryRun.productionWrites, 0);

  const evidencePath = path.join(DIR, EVIDENCE);
  const host = path.join(os.homedir(), ".openbot", "memory", "fixture.sqlite");
  const tmp = path.join(os.tmpdir(), "openbot-item6-evidence-fixture.sqlite");
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: "" }).status,
    "unconfigured",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: evidencePath }).status,
    "rejected-evidence-path",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: host }).status,
    "host-not-production-sot",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: tmp }).status,
    "rejected-fixture-path",
  );

  assert.equal(
    evaluateItem6Access({
      implementationUnlocked: false,
      phase1bExecutionBlocked: true,
      write: false,
      pathClass: "rejected-fixture-path",
      requestedTenant: "tenant-a",
      sqliteTenant: "tenant-a",
    }).reason,
    "identity-unproven",
  );
  assert.equal(
    evaluateItem6Access({
      implementationUnlocked: false,
      phase1bExecutionBlocked: true,
      write: false,
      pathClass: "production-candidate",
      requestedTenant: "tenant-a",
      sqliteTenant: "tenant-b",
    }).reason,
    "cross-tenant-denied",
  );
  assert.equal(
    evaluateItem6Access({
      implementationUnlocked: false,
      phase1bExecutionBlocked: true,
      write: true,
      pathClass: "production-candidate",
      requestedTenant: "tenant-a",
      sqliteTenant: "tenant-a",
    }).reason,
    "production-write-forbidden",
  );
  assert.equal(
    evaluateItem6Access({
      implementationUnlocked: false,
      phase1bExecutionBlocked: true,
      write: false,
      pathClass: "resource-layout-shadow",
      requestedTenant: "tenant-a",
      sqliteTenant: "tenant-a",
      restoreHashMismatch: true,
    }).reason,
    "restore-failed",
  );
  const allowed = evaluateItem6Access({
    implementationUnlocked: false,
    phase1bExecutionBlocked: true,
    write: false,
    pathClass: "resource-layout-shadow",
    requestedTenant: "tenant-a",
    sqliteTenant: "tenant-a",
  });
  assert.equal(allowed.allow, true);
  assert.equal(allowed.mode, "read-only-shadow");
  assert.equal(allowed.productionWrites, 0);
});

void test("item 6 shadow dry-run copies a fixture and never writes a production path", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "item6-evidence-"));
  const source = path.join(fixtureDir, "resource-fixture.sqlite");
  const backup = path.join(fixtureDir, "backup.sqlite");
  const restore = path.join(fixtureDir, "restore.sqlite");
  const payload = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.from("item6-shadow")]);
  fs.writeFileSync(source, payload);
  const before = createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  fs.copyFileSync(source, backup);
  fs.copyFileSync(backup, restore);
  const after = createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  assert.equal(before, after);
  assert.equal(fs.readFileSync(restore).equals(payload), true);
  fs.rmSync(fixtureDir, { recursive: true, force: true });

  const schema = readRepo("src/memory/schema-v2.ts");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
});

void test("item 6 package and ancestry stay off the I4 dirty tree", () => {
  const pkg = readRepo(
    ".kiro/specs/memory-workspace-platform-remediation/phase1b-item6-evidence-package.md",
  );
  const handoff = readRepo(
    ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item6-evidence.md",
  );
  assert.match(pkg, /evidence-preparation/);
  assert.match(pkg, /not-met/);
  assert.doesNotMatch(pkg, /implementationUnlocked": true/);
  assert.doesNotMatch(pkg, /phase1bExecutionBlocked=false/);
  assert.match(handoff, /Item 6 Evidence Preparation Review only/);
  assert.match(handoff, /does not request Item 6 implementation unlock/);
  assert.match(handoff, /## Not requested/);
  assert.doesNotMatch(handoff, /requests Item 6 implementation start/i);
  assert.ok(!REPO.includes(I4), REPO);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", "origin/main", "HEAD"]), true);
});
