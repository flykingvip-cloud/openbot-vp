import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { M3_VERIFY_RECEIPT_KIND } from "../../gateway/data-governance/migration-verify.js";
import {
  classifyFollowupWorkspaceChange,
  findVerifiedWorkspaceMigrationReceipt,
  isCompleteVerifiedMigration,
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
  fromDir: string,
  toDir: string,
  overrides: Partial<VerifiedMigrationReceiptEvidence> = {},
): VerifiedMigrationReceiptEvidence {
  return {
    receiptId: "receipt-1",
    resourceId: RESOURCE,
    tenantId: "tenant",
    passed: true,
    fromBindingId: "binding",
    toBindingId: "binding-migrated",
    fromContentVersion: "2",
    toContentVersion: "4",
    fromDirectoryRealpath: fromDir,
    toDirectoryRealpath: toDir,
    authorizationIdentity: "tenant:tenant:grant:migration-batch-b1",
    operationIdentity: "tenant:tenant:operator:candidate-c1",
    catalogBindingVerified: true,
    ownershipTenantVerified: true,
    artifactSet: [{ artifactId: RESOURCE, checksum: "sha256:abcd1234abcd1234abcd1234abcd1234" }],
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
    verifiedMigration: receipt(fromDir, toDir, {
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
    verifiedMigration: receipt(root, path.join(root, "moved"), {
      passed: true,
      catalogBindingVerified: false,
      ownershipTenantVerified: false,
      artifactIdentityVerified: false,
      integrityVerified: false,
      artifactSet: [],
    }),
  });
  expect(incompleteReceipt.destination).toBe("recoverable_wait");
  expect(incompleteReceipt.missingItems).toEqual(
    expect.arrayContaining([
      "migration_receipt_catalog_binding",
      "migration_receipt_ownership_tenant",
      "migration_receipt_artifact_set",
      "migration_receipt_integrity",
    ]),
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
    catalogBindingVerified: true,
    ownershipTenantVerified: true,
    artifactIdentityVerified: true,
    integrityVerified: false,
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
    catalogBindingVerified: false,
    ownershipTenantVerified: false,
    artifactIdentityVerified: false,
    integrityVerified: false,
  });
  const applyClassified = classifyFollowupWorkspaceChange({
    saved: saved(receiptDir),
    current: current(receiptDir, { bindingId: "binding-migrated" }),
    savedRealpath: receiptDir,
    requiredOperation: "write",
    verifiedMigration: applyOnly,
  });
  expect(applyClassified.destination).toBe("recoverable_wait");
});

it("does not let a same-resource historical receipt approve a later, different migration", () => {
  const fromDir = makeDir("t171-old-receipt-from-");
  const oldToDir = makeDir("t171-old-receipt-to-");
  const newToDir = makeDir("t171-new-migration-to-");
  const historical = receipt(fromDir, oldToDir, {
    receiptId: "old-receipt",
    toBindingId: "binding-old-target",
    toContentVersion: "4",
    toDirectoryRealpath: oldToDir,
  });
  const result = classifyFollowupWorkspaceChange({
    saved: saved(fromDir),
    current: current(newToDir, { bindingId: "binding-new-target", contentVersion: "6" }),
    savedRealpath: fromDir,
    requiredOperation: "write",
    verifiedMigration: historical,
  });
  expect(result.destination).toBe("recoverable_wait");
  expect(result.missingItems).toEqual(
    expect.arrayContaining([
      "migration_receipt_target_binding",
      "migration_receipt_target_version",
      "migration_receipt_target_directory",
    ]),
  );
  expect(
    isCompleteVerifiedMigration(
      historical,
      saved(fromDir),
      current(newToDir, { bindingId: "binding-new-target", contentVersion: "6" }),
      fromDir,
    ),
  ).toMatchObject({ ok: false });
});

it("does not treat a receipt missing required from/to, identity, or artifact-set fields as complete", () => {
  const fromDir = makeDir("t171-missing-fields-from-");
  const toDir = makeDir("t171-missing-fields-to-");
  const incomplete = receipt(fromDir, toDir, {
    fromBindingId: undefined,
    toBindingId: undefined,
    fromContentVersion: undefined,
    toContentVersion: undefined,
    fromDirectoryRealpath: undefined,
    toDirectoryRealpath: undefined,
    authorizationIdentity: undefined,
    operationIdentity: undefined,
    artifactSet: [],
    integrityVerified: false,
  });
  const result = classifyFollowupWorkspaceChange({
    saved: saved(fromDir),
    current: current(toDir, { bindingId: "binding-migrated", contentVersion: "4" }),
    savedRealpath: fromDir,
    requiredOperation: "write",
    verifiedMigration: incomplete,
  });
  expect(result.destination).toBe("recoverable_wait");
  expect(result.missingItems).toEqual(
    expect.arrayContaining([
      "migration_receipt_source_binding",
      "migration_receipt_target_binding",
      "migration_receipt_source_version",
      "migration_receipt_target_version",
      "migration_receipt_source_directory",
      "migration_receipt_target_directory",
      "migration_receipt_authorization_identity",
      "migration_receipt_operation_identity",
      "migration_receipt_artifact_set",
      "migration_receipt_integrity",
    ]),
  );
});

it("requires both catalog_binding and ownership_tenant; either check alone is not enough", () => {
  const fromDir = makeDir("t171-identity-and-from-");
  const toDir = makeDir("t171-identity-and-to-");
  const catalogOnly = classifyFollowupWorkspaceChange({
    saved: saved(fromDir),
    current: current(toDir, { bindingId: "binding-migrated", contentVersion: "4" }),
    savedRealpath: fromDir,
    requiredOperation: "write",
    verifiedMigration: receipt(fromDir, toDir, {
      catalogBindingVerified: true,
      ownershipTenantVerified: false,
      artifactIdentityVerified: true,
    }),
  });
  expect(catalogOnly.destination).toBe("recoverable_wait");
  expect(catalogOnly.missingItems).toEqual(
    expect.arrayContaining(["migration_receipt_ownership_tenant"]),
  );

  const ownershipOnly = classifyFollowupWorkspaceChange({
    saved: saved(fromDir),
    current: current(toDir, { bindingId: "binding-migrated", contentVersion: "4" }),
    savedRealpath: fromDir,
    requiredOperation: "write",
    verifiedMigration: receipt(fromDir, toDir, {
      catalogBindingVerified: false,
      ownershipTenantVerified: true,
      artifactIdentityVerified: true,
    }),
  });
  expect(ownershipOnly.destination).toBe("recoverable_wait");
  expect(ownershipOnly.missingItems).toEqual(
    expect.arrayContaining(["migration_receipt_catalog_binding"]),
  );
});

it("does not continue when a receipt is inconsistent with the current directory change", () => {
  const fromDir = makeDir("t171-mismatch-from-");
  const toDir = makeDir("t171-mismatch-to-");
  const otherDir = makeDir("t171-mismatch-other-");
  const result = classifyFollowupWorkspaceChange({
    saved: saved(fromDir),
    current: current(toDir, { bindingId: "binding-migrated", contentVersion: "4" }),
    savedRealpath: fromDir,
    requiredOperation: "write",
    verifiedMigration: receipt(fromDir, otherDir, {
      fromBindingId: "binding-other-source",
      toBindingId: "binding-other-target",
      fromContentVersion: "1",
      toContentVersion: "9",
    }),
  });
  expect(result.destination).toBe("recoverable_wait");
  expect(result.code).not.toBe("authorized_migration");
  expect(result.missingItems).toEqual(
    expect.arrayContaining([
      "migration_receipt_source_binding",
      "migration_receipt_target_binding",
      "migration_receipt_source_version",
      "migration_receipt_target_version",
      "migration_receipt_target_directory",
    ]),
  );
});

it("parses retained from/to binding fields and the checksummed artifact set from a verify receipt", () => {
  const fromDir = makeDir("t171-parse-from-");
  const toDir = makeDir("t171-parse-to-");
  const receiptDir = makeDir("t171-parse-receipts-");
  const payload = {
    kind: M3_VERIFY_RECEIPT_KIND,
    receiptId: "v-bound",
    batchId: "b1",
    tenantId: "tenant",
    resourceId: RESOURCE,
    candidateId: "c1",
    passed: true,
    fromBindingId: "binding",
    toBindingId: "binding-migrated",
    fromContentVersion: "2",
    toContentVersion: "4",
    fromDirectoryRealpath: fromDir,
    toDirectoryRealpath: toDir,
    authorizationIdentity: "tenant:tenant:grant:migration-batch-b1",
    operationIdentity: "tenant:tenant:operator:candidate-c1",
    artifactSet: [{ artifactId: RESOURCE, checksum: "sha256:abcd1234abcd1234abcd1234abcd1234" }],
    findings: [
      { check: "catalog_binding", outcome: "passed", detail: toDir },
      { check: "checksum", outcome: "passed", detail: "sha256:abcd1234abcd1234abcd1234abcd1234" },
      { check: "ownership_tenant", outcome: "passed", detail: "position:seat" },
    ],
    legalHold: null,
    retention: null,
  };
  const parsed = migrationReceiptToEvidence(payload);
  expect(parsed).toMatchObject({
    receiptId: "v-bound",
    fromBindingId: "binding",
    toBindingId: "binding-migrated",
    fromContentVersion: "2",
    toContentVersion: "4",
    fromDirectoryRealpath: fs.realpathSync(fromDir),
    toDirectoryRealpath: fs.realpathSync(toDir),
    authorizationIdentity: "tenant:tenant:grant:migration-batch-b1",
    operationIdentity: "tenant:tenant:operator:candidate-c1",
    catalogBindingVerified: true,
    ownershipTenantVerified: true,
    integrityVerified: true,
    artifactSet: [{ artifactId: RESOURCE, checksum: "sha256:abcd1234abcd1234abcd1234abcd1234" }],
  });
  fs.writeFileSync(path.join(receiptDir, "verify.json"), `${JSON.stringify(payload)}\n`);
  const found = findVerifiedWorkspaceMigrationReceipt({
    receiptDirs: [receiptDir],
    resourceId: RESOURCE,
    tenantId: "tenant",
    saved: saved(fromDir),
    current: current(toDir, { bindingId: "binding-migrated", contentVersion: "4" }),
    savedRealpath: fromDir,
  });
  expect(found?.receiptId).toBe("v-bound");
  expect(
    classifyFollowupWorkspaceChange({
      saved: saved(fromDir),
      current: current(toDir, { bindingId: "binding-migrated", contentVersion: "4" }),
      savedRealpath: fromDir,
      requiredOperation: "write",
      verifiedMigration: found,
    }).destination,
  ).toBe("continue");
});
