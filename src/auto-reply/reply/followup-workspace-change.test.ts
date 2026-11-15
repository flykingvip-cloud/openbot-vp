import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { M3_VERIFY_RECEIPT_KIND } from "../../gateway/data-governance/migration-verify.js";
import {
  classifyFollowupWorkspaceChange,
  findVerifiedWorkspaceMigrationReceipt,
  migrationReceiptToEvidence,
  type FollowupWorkspaceCurrentEvidence,
  type FollowupWorkspaceSnapshot,
  type VerifiedMigrationReceiptEvidence,
} from "./followup-workspace-change.js";

const RESOURCE = "ws:tenant:seat:seat:asset:asset";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function saved(
  rootPath: string,
  overrides: Partial<FollowupWorkspaceSnapshot> = {},
): FollowupWorkspaceSnapshot {
  return {
    resourceId: RESOURCE,
    bindingId: "binding",
    contentVersion: "2",
    workspaceDir: rootPath,
    tenantId: "tenant",
    owner: { kind: "position", seatId: "seat" },
    lifecycleState: "active",
    bindingState: "active",
    ...overrides,
  };
}

function current(
  rootPath: string,
  overrides: Partial<FollowupWorkspaceCurrentEvidence> = {},
): FollowupWorkspaceCurrentEvidence {
  return {
    resourceId: RESOURCE,
    bindingId: "binding",
    contentVersion: "2",
    rootPath,
    realpath: rootPath,
    tenantId: "tenant",
    owner: { kind: "position", seatId: "seat" },
    lifecycleState: "active",
    bindingState: "active",
    operationAllowed: true,
    ...overrides,
  };
}

function receipt(
  overrides: Partial<VerifiedMigrationReceiptEvidence> = {},
): VerifiedMigrationReceiptEvidence {
  return {
    receiptId: "receipt-1",
    resourceId: RESOURCE,
    tenantId: "tenant",
    passed: true,
    fromBindingId: "binding",
    toBindingId: "binding-migrated",
    artifactIdentityVerified: true,
    integrityVerified: true,
    ...overrides,
  };
}

it("normalizes a path-representation change when the real directory and resource identity are unchanged", () => {
  const root = makeDir("t170-classify-norm-");
  const alias = path.join(root, "alias");
  fs.symlinkSync(root, alias);
  const real = fs.realpathSync(root);
  const result = classifyFollowupWorkspaceChange({
    saved: saved(alias),
    current: current(real),
    savedRealpath: real,
    requiredOperation: "write",
  });
  expect(result).toMatchObject({
    destination: "continue",
    code: "path_normalized",
    askUser: false,
    pathNormalization: { from: alias, to: real },
  });
});

it("continues a contentVersion change when ownership, permission, and directory are unchanged, and records both versions", () => {
  const root = makeDir("t170-classify-version-");
  const result = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(root, { contentVersion: "3" }),
    savedRealpath: root,
    requiredOperation: "write",
  });
  expect(result).toMatchObject({
    destination: "continue",
    code: "content_version_changed",
    askUser: false,
    contentVersionChange: { from: "2", to: "3" },
  });
});

it("continues an authorized migration after a complete verify receipt matches the same resource", () => {
  const fromDir = makeDir("t170-classify-mig-from-");
  const toDir = makeDir("t170-classify-mig-to-");
  const result = classifyFollowupWorkspaceChange({
    saved: saved(fromDir),
    current: current(toDir, { bindingId: "binding-migrated", contentVersion: "4" }),
    savedRealpath: fromDir,
    requiredOperation: "write",
    verifiedMigration: receipt({
      toLocator: toDir,
      fromLocator: fromDir,
    }),
  });
  expect(result).toMatchObject({
    destination: "continue",
    code: "authorized_migration",
    askUser: false,
    migration: {
      receiptId: "receipt-1",
      fromBindingId: "binding",
      toBindingId: "binding-migrated",
      fromPath: fromDir,
      toPath: toDir,
    },
    contentVersionChange: { from: "2", to: "4" },
  });
});

it("waits with a concrete missing-item list when evidence is incomplete or a binding change is unverified", () => {
  const root = makeDir("t170-classify-wait-");
  const missingSnapshot = classifyFollowupWorkspaceChange({
    saved: { workspaceDir: root },
    current: current(root),
    savedRealpath: root,
    requiredOperation: "write",
  });
  expect(missingSnapshot).toMatchObject({
    destination: "recoverable_wait",
    code: "missing_evidence",
    askUser: false,
  });
  expect(missingSnapshot.missingItems).toEqual(
    expect.arrayContaining(["saved_resourceId", "saved_bindingId"]),
  );

  const unverifiedBinding = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(root, { bindingId: "binding-rotated" }),
    savedRealpath: root,
    requiredOperation: "write",
  });
  expect(unverifiedBinding).toMatchObject({
    destination: "recoverable_wait",
    code: "unverified_binding_change",
    askUser: false,
  });
  expect(unverifiedBinding.missingItems).toEqual(
    expect.arrayContaining(["verified_migration_receipt"]),
  );

  const incompleteReceipt = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(path.join(root, "moved"), { bindingId: "binding-migrated" }),
    requiredOperation: "write",
    verifiedMigration: receipt({
      passed: true,
      artifactIdentityVerified: false,
      integrityVerified: false,
    }),
  });
  expect(incompleteReceipt.destination).toBe("recoverable_wait");
  expect(incompleteReceipt.missingItems).toEqual(
    expect.arrayContaining(["migration_receipt_artifact_identity", "migration_receipt_integrity"]),
  );
});

it("requires reauthorization when tenant, owner, or permission changes, and does not auto-continue", () => {
  const root = makeDir("t170-classify-reauth-");
  const ownerChanged = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(root, { owner: { kind: "position", seatId: "other-seat" } }),
    savedRealpath: root,
    requiredOperation: "write",
  });
  expect(ownerChanged).toMatchObject({
    destination: "reauthorization_required",
    askUser: true,
    reauthorization: { kind: "owner" },
  });
  expect(ownerChanged.askUserDetail).toMatch(/ownership changed/i);

  const permissionChanged = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(root, { operationAllowed: false, bindingState: "read_only" }),
    savedRealpath: root,
    requiredOperation: "write",
  });
  expect(permissionChanged).toMatchObject({
    destination: "reauthorization_required",
    askUser: true,
    reauthorization: { kind: "permission" },
  });

  const resolvePermission = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: null,
    resolveError: "workspace_binding_required:lifecycle_denied",
    requiredOperation: "write",
  });
  expect(resolvePermission).toMatchObject({
    destination: "reauthorization_required",
    askUser: true,
    reauthorization: { kind: "permission" },
  });
});

it("denies a revoked resource, a cross-tenant current workspace, and a cross-resource access attempt", () => {
  const root = makeDir("t170-classify-deny-");
  const revoked = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(root, { lifecycleState: "purged" }),
    savedRealpath: root,
    requiredOperation: "write",
    savedCatalogLifecycle: "purged",
  });
  expect(revoked).toMatchObject({
    destination: "denied",
    askUser: false,
    reason: expect.stringMatching(/revoked:purged/),
  });

  const crossTenant = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(root, {
      resourceId: "ws:other-tenant:seat:seat:asset:asset",
      tenantId: "other-tenant",
    }),
    savedRealpath: root,
    requiredOperation: "write",
  });
  expect(crossTenant).toMatchObject({
    destination: "denied",
    askUser: false,
    reason: expect.stringMatching(/cross_tenant/),
  });

  const crossResource = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(root, {
      resourceId: "ws:tenant:seat:seat:asset:other-asset",
    }),
    savedRealpath: root,
    requiredOperation: "write",
  });
  expect(crossResource).toMatchObject({
    destination: "denied",
    askUser: false,
    reason: expect.stringMatching(/cross_resource/),
  });
});

it("does not treat a contentVersion difference alone as a permanent block", () => {
  const root = makeDir("t170-classify-version-signal-");
  const result = classifyFollowupWorkspaceChange({
    saved: saved(root, { contentVersion: "2" }),
    current: current(root, { contentVersion: "99" }),
    savedRealpath: root,
    requiredOperation: "read",
  });
  expect(result.destination).toBe("continue");
  expect(result.contentVersionChange).toEqual({ from: "2", to: "99" });
});

it("does not treat the same path string alone as proof of safety", () => {
  const root = makeDir("t170-classify-same-path-");
  const result = classifyFollowupWorkspaceChange({
    saved: saved(root),
    current: current(root, {
      resourceId: "ws:other-tenant:seat:seat:asset:asset",
      tenantId: "other-tenant",
    }),
    savedRealpath: root,
    requiredOperation: "write",
  });
  expect(result.destination).toBe("denied");
});

it("reads a passed verify receipt from disk and still rejects an incomplete apply receipt as unverified", () => {
  const receiptDir = makeDir("t170-receipts-");
  const verifyPath = path.join(receiptDir, "verify.json");
  fs.writeFileSync(
    verifyPath,
    JSON.stringify({
      kind: M3_VERIFY_RECEIPT_KIND,
      receiptId: "v1",
      batchId: "b1",
      tenantId: "tenant",
      resourceId: RESOURCE,
      candidateId: "c1",
      passed: true,
      findings: [
        { check: "catalog_binding", outcome: "passed", detail: "ok" },
        { check: "checksum", outcome: "passed", detail: "ok" },
        { check: "ownership_tenant", outcome: "passed", detail: "ok" },
      ],
      legalHold: null,
      retention: null,
    }),
  );
  const found = findVerifiedWorkspaceMigrationReceipt({
    receiptDirs: [receiptDir],
    resourceId: RESOURCE,
    tenantId: "tenant",
  });
  expect(found).toMatchObject({
    receiptId: "v1",
    passed: true,
    artifactIdentityVerified: true,
    integrityVerified: true,
  });

  const applyOnly = migrationReceiptToEvidence({
    kind: "m2_migration_receipt",
    receiptId: "m2",
    tenantId: "tenant",
    resourceId: RESOURCE,
    status: "migrated",
    previousLocator: "/old",
    canonicalBindingId: "binding-migrated",
  });
  expect(applyOnly).toMatchObject({
    passed: true,
    artifactIdentityVerified: false,
    integrityVerified: false,
  });
});
