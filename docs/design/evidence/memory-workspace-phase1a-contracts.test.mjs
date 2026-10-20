import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("catalog contract: DG Catalog is unique SoT and coverage stays 0%", () => {
  const doc = load("memory-workspace-phase1a-catalog-contract.json");
  assert.equal(doc.phase, "1A-design-only");
  assert.match(doc.sot.uniqueCatalog, /Data Governance Catalog/);
  assert.match(doc.sot.workspaceAdapter, /read-only/);
  assert.equal(doc.coverageHonesty.persistentCatalogCoverage, "0%");
  assert.equal(doc.coverageHonesty.persistentGovernanceCatalogExists, false);
  assert.equal(doc.persistentIdentity.field, "resourceId");
  assert.ok(doc.sot.forbidden.includes("Catalog miss=deny in production before Phase 1B unlock"));
  assert.ok(doc.explicitlyForbidden.includes("deployAuthorized=true"));
});

void test("membership contract: reuse platform-auth; no new SoT; department is not a parent dir", () => {
  const doc = load("memory-workspace-phase1a-membership-contract.json");
  assert.match(doc.authorities.employeeMembership, /platform-auth/);
  assert.ok(doc.forbiddenNewSot.includes("employee membership SoT inside memory-workspace"));
  assert.equal(doc.departmentRule.isNot.includes("physical parent"), true);
  assert.ok(doc.explicitlyForbidden.includes("department-as-physical-parent"));
});

void test("binding matrix covers the required eleven topics", () => {
  const doc = load("memory-workspace-phase1a-binding-impact-matrix.json");
  const ids = new Set(doc.rows.map((r) => r.id));
  for (const id of [
    "canonical-binding",
    "workspace-data-role",
    "storage-kind",
    "object-key",
    "cutover-receipt",
    "deletion-marker",
    "purge-archive-forget",
    "resolver-cache-key",
    "export-import",
    "rollback",
    "old-process-fail-closed",
  ]) {
    assert.ok(ids.has(id), `missing row ${id}`);
  }
  assert.equal(doc.reuse.bindingType, "WorkspaceBindingRecord");
  assert.equal(doc.offlineBootstrap.writesProductionCatalog, false);
  assert.equal(doc.rows.length, 11);
});

void test("memory boundary: Workspace role != Memory Asset; no shared identity", () => {
  const doc = load("memory-workspace-phase1a-memory-boundary.json");
  assert.equal(doc.boundaries.workspaceMemoryRole.isNot, "A Memory Asset");
  assert.match(doc.boundaries.memoryAsset.relation, /sourceWorkspaceResourceId/);
  assert.equal(doc.boundaries.sqlitePartition.column, "workspace_id");
  assert.ok(doc.phase1aForbidden.includes("edit src/memory/** production implementation"));
  assert.ok(doc.explicitlyForbidden.includes("shared identity between Memory Asset and Workspace"));
});

void test("phase1a contracts do not authorize LIVE or Phase 1B", () => {
  for (const file of [
    "memory-workspace-phase1a-catalog-contract.json",
    "memory-workspace-phase1a-membership-contract.json",
    "memory-workspace-phase1a-binding-impact-matrix.json",
    "memory-workspace-phase1a-memory-boundary.json",
  ]) {
    const doc = load(file);
    assert.ok(doc.explicitlyForbidden.includes("deployAuthorized=true"), file);
    assert.equal(doc.phase === "1A-design-only" || doc.phase === undefined, true);
  }
});
