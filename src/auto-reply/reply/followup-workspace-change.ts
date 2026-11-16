import fs from "node:fs";
import path from "node:path";
import { MIGRATION_RECEIPT_KIND } from "../../gateway/data-governance/migration-apply.js";
import {
  M3_VERIFY_RECEIPT_KIND,
  type MigrationVerifyReceipt,
} from "../../gateway/data-governance/migration-verify.js";
import { getSharedDataGovernanceCatalog } from "../../gateway/data-governance/runtime-catalog.js";
import type { CatalogRecord } from "../../gateway/data-governance/types.js";

export const FOLLOWUP_WORKSPACE_RETRY_CAP = 5;

export type FollowupWorkspaceDestination =
  | "continue"
  | "recoverable_wait"
  | "reauthorization_required"
  | "denied";

export type FollowupWorkspaceOwner =
  | { kind: "user"; userId: string }
  | { kind: "position"; seatId: string }
  | { kind: "group"; groupId: string }
  | { kind: "system"; systemId: string };

export type FollowupWorkspaceSnapshot = {
  resourceId?: string;
  bindingId?: string;
  contentVersion?: string;
  workspaceDir?: string;
  tenantId?: string;
  owner?: FollowupWorkspaceOwner;
  lifecycleState?: string;
  bindingState?: string;
};

export type FollowupWorkspaceCurrentEvidence = {
  resourceId: string;
  bindingId: string;
  contentVersion: string;
  rootPath: string;
  realpath: string;
  tenantId?: string;
  owner?: FollowupWorkspaceOwner;
  lifecycleState?: string;
  bindingState?: string;
  operationAllowed: boolean;
};

export type MigrationArtifactIntegrity = {
  artifactId: string;
  checksum: string;
};

export type FollowupReauthorizationGrant = {
  kind: "tenant" | "owner" | "permission";
  actorIdentity: string;
  grantedAtMs: number;
};

export type VerifiedMigrationReceiptEvidence = {
  receiptId: string;
  resourceId: string;
  tenantId?: string;
  passed: boolean;
  fromBindingId?: string;
  toBindingId?: string;
  fromContentVersion?: string;
  toContentVersion?: string;
  fromDirectoryRealpath?: string;
  toDirectoryRealpath?: string;
  fromLocator?: string;
  toLocator?: string;
  authorizationIdentity?: string;
  operationIdentity?: string;
  catalogBindingVerified: boolean;
  ownershipTenantVerified: boolean;
  artifactSet?: MigrationArtifactIntegrity[];
  artifactIdentityVerified: boolean;
  integrityVerified: boolean;
};

export type FollowupWorkspaceClassificationCode =
  | "unchanged"
  | "path_normalized"
  | "content_version_changed"
  | "authorized_migration"
  | "missing_evidence"
  | "unverified_binding_change"
  | "reauthorization_required"
  | "denied";

export type FollowupWorkspaceClassification = {
  destination: FollowupWorkspaceDestination;
  reason: string;
  code: FollowupWorkspaceClassificationCode;
  missingItems?: string[];
  pathNormalization?: { from: string; to: string };
  contentVersionChange?: { from: string; to: string };
  migration?: {
    receiptId: string;
    fromBindingId?: string;
    toBindingId?: string;
    fromContentVersion?: string;
    toContentVersion?: string;
    fromPath?: string;
    toPath?: string;
    authorizationIdentity?: string;
    operationIdentity?: string;
    artifactSet?: MigrationArtifactIntegrity[];
  };
  reauthorization?: {
    kind: "tenant" | "owner" | "permission";
    detail: string;
  };
  askUser: boolean;
  askUserDetail?: string;
};

const DENY_LIFECYCLES = new Set(["purged", "deletion_pending", "quarantined", "retired"]);

const RESOLVE_WAIT_REASONS = new Set([
  "directory_missing",
  "binding_unplaced",
  "not_directory",
  "resource_missing_or_ambiguous",
  "canonical_missing_or_ambiguous",
  "owner_missing_or_ambiguous",
  "trusted_identity_missing",
  "binding_identity_mismatch",
]);

const RESOLVE_PERMISSION_REASONS = new Set([
  "lifecycle_denied",
  "binding_read_only",
  "asset_inactive",
]);

export function ownerKey(owner?: FollowupWorkspaceOwner | null): string | undefined {
  if (!owner) {
    return undefined;
  }
  switch (owner.kind) {
    case "user":
      return `user:${owner.userId}`;
    case "position":
      return `position:${owner.seatId}`;
    case "group":
      return `group:${owner.groupId}`;
    case "system":
      return `system:${owner.systemId}`;
  }
}

export function tenantIdFromResourceId(resourceId?: string): string | undefined {
  if (!resourceId) {
    return undefined;
  }
  const match = /^ws:([^:]+):/.exec(resourceId);
  return match?.[1] || undefined;
}

export function parseWorkspaceBindingRequiredReason(message?: string | null): string | undefined {
  if (!message) {
    return undefined;
  }
  const match = /workspace_binding_required:([a-z0-9_]+)/i.exec(message);
  return match?.[1];
}

export function resolveWorkspaceRealpath(workspaceDir?: string | null): string | null {
  const value = workspaceDir?.trim();
  if (!value) {
    return null;
  }
  try {
    const real = fs.realpathSync(value);
    return fs.statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

function snapshotTenant(
  saved: FollowupWorkspaceSnapshot,
  catalogTenantId?: string | null,
): string | undefined {
  return (
    catalogTenantId?.trim() || saved.tenantId?.trim() || tenantIdFromResourceId(saved.resourceId)
  );
}

function currentTenantOf(current: FollowupWorkspaceCurrentEvidence): string | undefined {
  return current.tenantId?.trim() || tenantIdFromResourceId(current.resourceId);
}

function continueResult(
  partial: Omit<FollowupWorkspaceClassification, "destination" | "askUser">,
): FollowupWorkspaceClassification {
  return { destination: "continue", askUser: false, ...partial };
}

function waitResult(
  reason: string,
  missingItems: string[],
  code: FollowupWorkspaceClassificationCode = "missing_evidence",
): FollowupWorkspaceClassification {
  return {
    destination: "recoverable_wait",
    reason,
    code,
    missingItems,
    askUser: false,
  };
}

function reauthResult(
  kind: "tenant" | "owner" | "permission",
  detail: string,
): FollowupWorkspaceClassification {
  return {
    destination: "reauthorization_required",
    reason: `followup_workspace_reauthorization_required:${kind}`,
    code: "reauthorization_required",
    reauthorization: { kind, detail },
    askUser: true,
    askUserDetail: detail,
  };
}

function denyResult(reason: string): FollowupWorkspaceClassification {
  return {
    destination: "denied",
    reason,
    code: "denied",
    askUser: false,
  };
}

function lifecycleOf(
  current?: FollowupWorkspaceCurrentEvidence | null,
  savedCatalogLifecycle?: string | null,
  saved?: FollowupWorkspaceSnapshot,
): string | undefined {
  return current?.lifecycleState || savedCatalogLifecycle || saved?.lifecycleState || undefined;
}

function requiredText(value?: string | null): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function directoryToken(value?: string | null): string | undefined {
  const text = requiredText(value);
  if (!text) {
    return undefined;
  }
  return resolveWorkspaceRealpath(text) ?? text;
}

export function isCompleteVerifiedMigration(
  receipt: VerifiedMigrationReceiptEvidence | null | undefined,
  saved: FollowupWorkspaceSnapshot,
  current: FollowupWorkspaceCurrentEvidence,
  savedRealpath?: string | null,
): { ok: true } | { ok: false; missing: string[] } {
  if (!receipt) {
    return { ok: false, missing: ["verified_migration_receipt"] };
  }
  const missing: string[] = [];
  if (!receipt.passed) {
    missing.push("migration_receipt_passed");
  }
  if (
    !requiredText(receipt.resourceId) ||
    receipt.resourceId !== saved.resourceId ||
    receipt.resourceId !== current.resourceId
  ) {
    missing.push("migration_receipt_resource_identity");
  }
  const savedTenant = snapshotTenant(saved);
  const currentTenant = currentTenantOf(current);
  if (!requiredText(receipt.tenantId)) {
    missing.push("migration_receipt_tenant");
  } else if (
    (savedTenant && receipt.tenantId !== savedTenant) ||
    (currentTenant && receipt.tenantId !== currentTenant)
  ) {
    missing.push("migration_receipt_tenant");
  }
  if (!requiredText(receipt.fromBindingId)) {
    missing.push("migration_receipt_source_binding");
  } else if (receipt.fromBindingId !== saved.bindingId) {
    missing.push("migration_receipt_source_binding");
  }
  if (!requiredText(receipt.toBindingId)) {
    missing.push("migration_receipt_target_binding");
  } else if (receipt.toBindingId !== current.bindingId) {
    missing.push("migration_receipt_target_binding");
  }
  if (!requiredText(receipt.fromContentVersion)) {
    missing.push("migration_receipt_source_version");
  } else if (receipt.fromContentVersion !== (saved.contentVersion ?? "")) {
    missing.push("migration_receipt_source_version");
  }
  if (!requiredText(receipt.toContentVersion)) {
    missing.push("migration_receipt_target_version");
  } else if (receipt.toContentVersion !== current.contentVersion) {
    missing.push("migration_receipt_target_version");
  }
  const expectedFromDir =
    directoryToken(savedRealpath) ?? directoryToken(saved.workspaceDir) ?? undefined;
  const expectedToDir = directoryToken(current.realpath) ?? directoryToken(current.rootPath);
  const receiptFromDir = directoryToken(receipt.fromDirectoryRealpath);
  const receiptToDir = directoryToken(receipt.toDirectoryRealpath);
  if (!receiptFromDir) {
    missing.push("migration_receipt_source_directory");
  } else if (expectedFromDir && receiptFromDir !== expectedFromDir) {
    missing.push("migration_receipt_source_directory");
  }
  if (!receiptToDir) {
    missing.push("migration_receipt_target_directory");
  } else if (expectedToDir && receiptToDir !== expectedToDir) {
    missing.push("migration_receipt_target_directory");
  }
  if (!receipt.catalogBindingVerified) {
    missing.push("migration_receipt_catalog_binding");
  }
  if (!receipt.ownershipTenantVerified) {
    missing.push("migration_receipt_ownership_tenant");
  }
  const artifactSet = (receipt.artifactSet ?? []).filter(
    (row) => requiredText(row.artifactId) && requiredText(row.checksum),
  );
  if (artifactSet.length === 0) {
    missing.push("migration_receipt_artifact_set");
  }
  if (!receipt.integrityVerified || artifactSet.length === 0) {
    missing.push("migration_receipt_integrity");
  }
  if (!requiredText(receipt.authorizationIdentity)) {
    missing.push("migration_receipt_authorization_identity");
  }
  if (!requiredText(receipt.operationIdentity)) {
    missing.push("migration_receipt_operation_identity");
  }
  if (missing.length > 0) {
    return { ok: false, missing: [...new Set(missing)] };
  }
  return { ok: true };
}

function grantCovers(
  grant: FollowupReauthorizationGrant | null | undefined,
  kind: "tenant" | "owner" | "permission",
): boolean {
  if (!grant) {
    return false;
  }
  return Boolean(requiredText(grant.actorIdentity) && grant.kind === kind);
}

export function classifyFollowupWorkspaceChange(input: {
  saved: FollowupWorkspaceSnapshot;
  current?: FollowupWorkspaceCurrentEvidence | null;
  savedRealpath?: string | null;
  resolveError?: string | null;
  requiredOperation: "read" | "write";
  verifiedMigration?: VerifiedMigrationReceiptEvidence | null;
  savedCatalogLifecycle?: string | null;
  savedCatalogOwner?: FollowupWorkspaceOwner | null;
  savedCatalogTenantId?: string | null;
  trustedTenantId?: string | null;
  reauthorizationGrant?: FollowupReauthorizationGrant | null;
}): FollowupWorkspaceClassification {
  const saved = input.saved;
  const current = input.current ?? null;
  const savedCatalogLifecycle = input.savedCatalogLifecycle ?? null;
  const lifecycle = lifecycleOf(current, savedCatalogLifecycle, saved);
  const savedOwner = input.savedCatalogOwner ?? saved.owner;
  const savedTenant = snapshotTenant(saved, input.savedCatalogTenantId);
  const grant = input.reauthorizationGrant ?? null;

  if (lifecycle && DENY_LIFECYCLES.has(lifecycle)) {
    return denyResult(`followup_workspace_denied:revoked:${lifecycle}`);
  }

  if (!current) {
    const resolveReason = parseWorkspaceBindingRequiredReason(input.resolveError);
    if (resolveReason === "identity_mismatch") {
      if (input.trustedTenantId && savedTenant && input.trustedTenantId !== savedTenant) {
        return denyResult("followup_workspace_denied:cross_tenant");
      }
      const kind = savedOwner ? "owner" : "tenant";
      if (
        !grantCovers(grant, kind) &&
        !grantCovers(grant, "tenant") &&
        !grantCovers(grant, "owner")
      ) {
        return reauthResult(
          kind,
          savedOwner
            ? "Ownership no longer matches the trusted identity; reauthorization is required."
            : "Tenant or ownership no longer matches the trusted identity; reauthorization is required.",
        );
      }
    }
    if (resolveReason && RESOLVE_PERMISSION_REASONS.has(resolveReason)) {
      if (!grantCovers(grant, "permission")) {
        return reauthResult(
          "permission",
          `Required operation '${input.requiredOperation}' is no longer allowed (${resolveReason}).`,
        );
      }
    }
    const missing: string[] = [];
    if (!saved.resourceId) {
      missing.push("saved_resourceId");
    }
    if (!saved.bindingId) {
      missing.push("saved_bindingId");
    }
    if (resolveReason && RESOLVE_WAIT_REASONS.has(resolveReason)) {
      missing.push(resolveReason);
    } else if (input.resolveError) {
      missing.push("workspace_resolution");
    } else {
      missing.push("current_workspace_evidence");
    }
    return waitResult(
      resolveReason
        ? `followup_workspace_recoverable_wait:${resolveReason}`
        : "followup_workspace_recoverable_wait:missing_evidence",
      missing,
    );
  }

  if (!saved.resourceId || !saved.bindingId) {
    return waitResult("followup_workspace_recoverable_wait:missing_snapshot", [
      ...(!saved.resourceId ? ["saved_resourceId"] : []),
      ...(!saved.bindingId ? ["saved_bindingId"] : []),
    ]);
  }

  const currentTenant = currentTenantOf(current);
  if (savedTenant && currentTenant && savedTenant !== currentTenant) {
    return denyResult("followup_workspace_denied:cross_tenant");
  }
  if (saved.resourceId !== current.resourceId) {
    return denyResult("followup_workspace_denied:cross_resource");
  }

  const currentOwnerKey = ownerKey(current.owner);
  const savedOwnerKey = ownerKey(savedOwner);
  if (savedOwnerKey && currentOwnerKey && savedOwnerKey !== currentOwnerKey) {
    if (!grantCovers(grant, "owner")) {
      return reauthResult(
        "owner",
        "Workspace ownership changed; reauthorization is required before continuing.",
      );
    }
  }

  if (!current.operationAllowed) {
    if (!grantCovers(grant, "permission")) {
      return reauthResult(
        "permission",
        `Required operation '${input.requiredOperation}' is no longer allowed by lifecycle or binding state.`,
      );
    }
  }

  const savedRealpath = input.savedRealpath ?? resolveWorkspaceRealpath(saved.workspaceDir);
  const currentRealpath = current.realpath || current.rootPath;
  const sameRealDirectory = Boolean(
    savedRealpath && currentRealpath && savedRealpath === currentRealpath,
  );
  const savedPathString = saved.workspaceDir ? path.resolve(saved.workspaceDir) : undefined;
  const sameBinding = saved.bindingId === current.bindingId;
  const versionChanged = saved.contentVersion !== current.contentVersion;

  if (sameRealDirectory && sameBinding) {
    const pathNormalization =
      savedPathString && savedPathString !== current.rootPath
        ? { from: saved.workspaceDir ?? savedPathString, to: current.rootPath }
        : undefined;
    const contentVersionChange = versionChanged
      ? { from: saved.contentVersion ?? "", to: current.contentVersion }
      : undefined;
    if (pathNormalization && contentVersionChange) {
      return continueResult({
        reason: "followup_workspace_continue:normalized_and_version_changed",
        code: "content_version_changed",
        pathNormalization,
        contentVersionChange,
      });
    }
    if (pathNormalization) {
      return continueResult({
        reason: "followup_workspace_continue:path_normalized",
        code: "path_normalized",
        pathNormalization,
      });
    }
    if (contentVersionChange) {
      return continueResult({
        reason: "followup_workspace_continue:content_version_changed",
        code: "content_version_changed",
        contentVersionChange,
      });
    }
    return continueResult({
      reason: "followup_workspace_continue:unchanged",
      code: "unchanged",
    });
  }

  const receiptCheck = isCompleteVerifiedMigration(
    input.verifiedMigration,
    saved,
    current,
    savedRealpath,
  );
  if (!sameBinding || !sameRealDirectory) {
    if (receiptCheck.ok) {
      const receipt = input.verifiedMigration!;
      return continueResult({
        reason: "followup_workspace_continue:authorized_migration",
        code: "authorized_migration",
        migration: {
          receiptId: receipt.receiptId,
          fromBindingId: receipt.fromBindingId ?? saved.bindingId,
          toBindingId: receipt.toBindingId ?? current.bindingId,
          fromContentVersion: receipt.fromContentVersion,
          toContentVersion: receipt.toContentVersion,
          fromPath: receipt.fromDirectoryRealpath ?? saved.workspaceDir,
          toPath: receipt.toDirectoryRealpath ?? current.rootPath,
          authorizationIdentity: receipt.authorizationIdentity,
          operationIdentity: receipt.operationIdentity,
          artifactSet: receipt.artifactSet,
        },
        ...(versionChanged
          ? {
              contentVersionChange: {
                from: saved.contentVersion ?? "",
                to: current.contentVersion,
              },
            }
          : {}),
      });
    }
    const missing = !receiptCheck.ok ? receiptCheck.missing : ["verified_migration_receipt"];
    if (!sameBinding && sameRealDirectory) {
      return waitResult(
        "followup_workspace_recoverable_wait:unverified_binding_change",
        missing,
        "unverified_binding_change",
      );
    }
    return waitResult("followup_workspace_recoverable_wait:unverified_directory_change", missing);
  }

  return waitResult("followup_workspace_recoverable_wait:missing_evidence", [
    "classification_evidence",
  ]);
}

export type FollowupRevalidationEvidence = {
  savedCatalogLifecycle?: string | null;
  savedCatalogOwner?: FollowupWorkspaceOwner | null;
  savedCatalogTenantId?: string | null;
  verifiedMigration?: VerifiedMigrationReceiptEvidence | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findingPassed(
  findings: Array<{ check?: unknown; outcome?: unknown }> | undefined,
  check: string,
): boolean {
  return Boolean(findings?.some((row) => row.check === check && row.outcome === "passed"));
}

function findingDetail(
  findings: Array<{ check?: unknown; outcome?: unknown; detail?: unknown }> | undefined,
  check: string,
): string | undefined {
  const row = findings?.find((item) => item.check === check && item.outcome === "passed");
  return optionalString(row?.detail);
}

function parseArtifactSet(value: unknown): MigrationArtifactIntegrity[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: MigrationArtifactIntegrity[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const artifactId =
      optionalString(item.artifactId) ||
      optionalString(item.id) ||
      optionalString(item.locator) ||
      optionalString(item.resourceId);
    const checksum =
      optionalString(item.checksum) ||
      optionalString(item.contentChecksum) ||
      optionalString(item.digest);
    if (artifactId && checksum) {
      rows.push({ artifactId, checksum });
    }
  }
  return rows;
}

function isConcreteChecksum(value?: string): boolean {
  if (!value) {
    return false;
  }
  const lowered = value.toLowerCase();
  if (lowered === "ok" || lowered === "passed" || lowered === "true") {
    return false;
  }
  return (
    value.startsWith("sha256:") ||
    value.startsWith("sha512:") ||
    value.startsWith("checksum:") ||
    /^[a-f0-9]{32,}$/i.test(value)
  );
}

function artifactSetFromValue(value: Record<string, unknown>): MigrationArtifactIntegrity[] {
  const direct = parseArtifactSet(value.artifactSet ?? value.artifacts);
  if (direct.length > 0) {
    return direct;
  }
  const findings = Array.isArray(value.findings)
    ? (value.findings as Array<{ check?: unknown; outcome?: unknown; detail?: unknown }>)
    : undefined;
  const checksum = findingDetail(findings, "checksum");
  const locator = findingDetail(findings, "catalog_binding");
  const artifactId = optionalString(value.resourceId) || locator;
  if (artifactId && isConcreteChecksum(checksum)) {
    return [{ artifactId, checksum: checksum! }];
  }
  return [];
}

function bindingFieldsFromValue(value: Record<string, unknown>): {
  fromBindingId?: string;
  toBindingId?: string;
  fromContentVersion?: string;
  toContentVersion?: string;
  fromDirectoryRealpath?: string;
  toDirectoryRealpath?: string;
  fromLocator?: string;
  toLocator?: string;
  authorizationIdentity?: string;
  operationIdentity?: string;
} {
  const fromDirectoryRealpath = directoryToken(
    optionalString(value.fromDirectoryRealpath) ||
      optionalString(value.fromDirectory) ||
      optionalString(value.fromPath),
  );
  const toDirectoryRealpath = directoryToken(
    optionalString(value.toDirectoryRealpath) ||
      optionalString(value.toDirectory) ||
      optionalString(value.toPath),
  );
  return {
    fromBindingId: optionalString(value.fromBindingId),
    toBindingId: optionalString(value.toBindingId) || optionalString(value.canonicalBindingId),
    fromContentVersion: optionalString(value.fromContentVersion),
    toContentVersion: optionalString(value.toContentVersion),
    fromDirectoryRealpath,
    toDirectoryRealpath,
    fromLocator: optionalString(value.fromLocator) || optionalString(value.previousLocator),
    toLocator: optionalString(value.toLocator) || optionalString(value.canonicalLocator),
    authorizationIdentity:
      optionalString(value.authorizationIdentity) || optionalString(value.authorizedBy),
    operationIdentity:
      optionalString(value.operationIdentity) ||
      optionalString(value.operationId) ||
      optionalString(value.actorIdentity),
  };
}

export function migrationReceiptToEvidence(
  value: unknown,
): VerifiedMigrationReceiptEvidence | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === M3_VERIFY_RECEIPT_KIND) {
    const receipt = value as unknown as MigrationVerifyReceipt & Record<string, unknown>;
    if (!receipt.receiptId || !receipt.resourceId) {
      return null;
    }
    const findings = receipt.findings;
    const catalogBindingVerified = findingPassed(findings, "catalog_binding");
    const ownershipTenantVerified = findingPassed(findings, "ownership_tenant");
    const artifactSet = artifactSetFromValue(value);
    const bindings = bindingFieldsFromValue(value);
    return {
      receiptId: receipt.receiptId,
      resourceId: receipt.resourceId,
      tenantId: optionalString(receipt.tenantId),
      passed: receipt.passed,
      ...bindings,
      catalogBindingVerified,
      ownershipTenantVerified,
      artifactSet: artifactSet.length > 0 ? artifactSet : undefined,
      artifactIdentityVerified: catalogBindingVerified && ownershipTenantVerified,
      integrityVerified: findingPassed(findings, "checksum") && artifactSet.length > 0,
    };
  }
  if (value.kind === MIGRATION_RECEIPT_KIND) {
    // An apply receipt is not enough by itself: identity and integrity still
    // have to be verified. Surface it as incomplete evidence so the classifier
    // waits for a verify receipt rather than auto-continuing.
    const receiptId = optionalString(value.receiptId) ?? "";
    const resourceId = optionalString(value.resourceId) ?? "";
    if (!receiptId || !resourceId) {
      return null;
    }
    const bindings = bindingFieldsFromValue(value);
    return {
      receiptId,
      resourceId,
      tenantId: optionalString(value.tenantId),
      passed: value.status === "migrated",
      ...bindings,
      catalogBindingVerified: false,
      ownershipTenantVerified: false,
      artifactIdentityVerified: false,
      integrityVerified: false,
    };
  }
  return null;
}

export function listVerifiedMigrationReceipts(
  receiptDir?: string | null,
): VerifiedMigrationReceiptEvidence[] {
  const root = receiptDir?.trim();
  if (!root || !fs.existsSync(root)) {
    return [];
  }
  const rows: VerifiedMigrationReceiptEvidence[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(root, name);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const evidence = migrationReceiptToEvidence(parsed);
      if (evidence) {
        rows.push(evidence);
      }
    } catch {
      // Skip unreadable rows; absence of a valid receipt is fail-closed.
    }
  }
  return rows;
}

export function findVerifiedWorkspaceMigrationReceipt(params: {
  receiptDirs?: Array<string | undefined | null>;
  resourceId?: string;
  tenantId?: string;
  saved?: FollowupWorkspaceSnapshot;
  current?: FollowupWorkspaceCurrentEvidence | null;
  savedRealpath?: string | null;
}): VerifiedMigrationReceiptEvidence | null {
  const resourceId = params.resourceId?.trim();
  if (!resourceId) {
    return null;
  }
  const dirs = params.receiptDirs ?? [];
  const candidates: VerifiedMigrationReceiptEvidence[] = [];
  for (const receiptDir of dirs) {
    for (const row of listVerifiedMigrationReceipts(receiptDir)) {
      if (row.resourceId !== resourceId) {
        continue;
      }
      if (params.tenantId && row.tenantId && row.tenantId !== params.tenantId) {
        continue;
      }
      candidates.push(row);
    }
  }
  if (params.saved && params.current) {
    const complete = candidates.find(
      (row) =>
        isCompleteVerifiedMigration(row, params.saved!, params.current!, params.savedRealpath).ok,
    );
    if (complete) {
      return complete;
    }
  }
  return candidates[0] ?? null;
}

function catalogOwner(record: CatalogRecord): FollowupWorkspaceOwner | null {
  const owner = record.envelope.owner;
  if (!owner) {
    return null;
  }
  return owner as FollowupWorkspaceOwner;
}

export async function loadFollowupRevalidationEvidence(params: {
  resourceId?: string;
  sessionFile?: string;
  saved?: FollowupWorkspaceSnapshot;
  current?: FollowupWorkspaceCurrentEvidence | null;
}): Promise<FollowupRevalidationEvidence> {
  const evidence: FollowupRevalidationEvidence = {};
  const resourceId = params.resourceId?.trim() || params.saved?.resourceId;
  try {
    if (resourceId) {
      const record = await getSharedDataGovernanceCatalog().get(resourceId);
      if (record) {
        evidence.savedCatalogLifecycle = record.envelope.lifecycleState;
        evidence.savedCatalogOwner = catalogOwner(record);
        evidence.savedCatalogTenantId = record.envelope.tenantId;
      }
    }
  } catch {
    // Catalog lookup is bounded evidence, not a fallback workspace root.
  }
  try {
    const sessionDir = params.sessionFile ? path.dirname(path.resolve(params.sessionFile)) : "";
    const receiptDirs = sessionDir
      ? [path.join(sessionDir, "migration-receipts"), path.join(sessionDir, "receipts")]
      : [];
    evidence.verifiedMigration = findVerifiedWorkspaceMigrationReceipt({
      receiptDirs,
      resourceId,
      tenantId:
        evidence.savedCatalogTenantId ||
        params.saved?.tenantId ||
        tenantIdFromResourceId(resourceId),
      saved: params.saved,
      current: params.current,
      savedRealpath: params.saved ? resolveWorkspaceRealpath(params.saved.workspaceDir) : null,
    });
  } catch {
    // Missing receipt directories mean the migration is not verified.
  }
  return evidence;
}
