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

export type VerifiedMigrationReceiptEvidence = {
  receiptId: string;
  resourceId: string;
  tenantId?: string;
  passed: boolean;
  fromBindingId?: string;
  toBindingId?: string;
  fromLocator?: string;
  toLocator?: string;
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
    fromPath?: string;
    toPath?: string;
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

function isCompleteVerifiedMigration(
  receipt: VerifiedMigrationReceiptEvidence | null | undefined,
  saved: FollowupWorkspaceSnapshot,
  current: FollowupWorkspaceCurrentEvidence,
): { ok: true } | { ok: false; missing: string[] } {
  if (!receipt) {
    return { ok: false, missing: ["verified_migration_receipt"] };
  }
  const missing: string[] = [];
  if (!receipt.passed) {
    missing.push("migration_receipt_passed");
  }
  if (receipt.resourceId !== saved.resourceId || receipt.resourceId !== current.resourceId) {
    missing.push("migration_receipt_resource_identity");
  }
  const savedTenant = snapshotTenant(saved);
  const currentTenant = currentTenantOf(current);
  if (receipt.tenantId && savedTenant && receipt.tenantId !== savedTenant) {
    missing.push("migration_receipt_tenant");
  }
  if (receipt.tenantId && currentTenant && receipt.tenantId !== currentTenant) {
    missing.push("migration_receipt_tenant");
  }
  if (!receipt.artifactIdentityVerified) {
    missing.push("migration_receipt_artifact_identity");
  }
  if (!receipt.integrityVerified) {
    missing.push("migration_receipt_integrity");
  }
  if (receipt.fromBindingId && saved.bindingId && receipt.fromBindingId !== saved.bindingId) {
    missing.push("migration_receipt_source_binding");
  }
  if (receipt.toBindingId && receipt.toBindingId !== current.bindingId) {
    missing.push("migration_receipt_target_binding");
  }
  if (missing.length > 0) {
    return { ok: false, missing: [...new Set(missing)] };
  }
  return { ok: true };
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
}): FollowupWorkspaceClassification {
  const saved = input.saved;
  const current = input.current ?? null;
  const savedCatalogLifecycle = input.savedCatalogLifecycle ?? null;
  const lifecycle = lifecycleOf(current, savedCatalogLifecycle, saved);
  const savedOwner = input.savedCatalogOwner ?? saved.owner;
  const savedTenant = snapshotTenant(saved, input.savedCatalogTenantId);

  if (lifecycle && DENY_LIFECYCLES.has(lifecycle)) {
    return denyResult(`followup_workspace_denied:revoked:${lifecycle}`);
  }

  if (!current) {
    const resolveReason = parseWorkspaceBindingRequiredReason(input.resolveError);
    if (resolveReason === "identity_mismatch") {
      if (input.trustedTenantId && savedTenant && input.trustedTenantId !== savedTenant) {
        return denyResult("followup_workspace_denied:cross_tenant");
      }
      return reauthResult(
        savedOwner ? "owner" : "tenant",
        savedOwner
          ? "Ownership no longer matches the trusted identity; reauthorization is required."
          : "Tenant or ownership no longer matches the trusted identity; reauthorization is required.",
      );
    }
    if (resolveReason && RESOLVE_PERMISSION_REASONS.has(resolveReason)) {
      return reauthResult(
        "permission",
        `Required operation '${input.requiredOperation}' is no longer allowed (${resolveReason}).`,
      );
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
    return reauthResult(
      "owner",
      "Workspace ownership changed; reauthorization is required before continuing.",
    );
  }

  if (!current.operationAllowed) {
    return reauthResult(
      "permission",
      `Required operation '${input.requiredOperation}' is no longer allowed by lifecycle or binding state.`,
    );
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

  const receiptCheck = isCompleteVerifiedMigration(input.verifiedMigration, saved, current);
  if (!sameBinding || !sameRealDirectory) {
    if (receiptCheck.ok) {
      const receipt = input.verifiedMigration!;
      return continueResult({
        reason: "followup_workspace_continue:authorized_migration",
        code: "authorized_migration",
        migration: {
          receiptId: receipt.receiptId,
          fromBindingId: saved.bindingId,
          toBindingId: current.bindingId,
          fromPath: saved.workspaceDir,
          toPath: current.rootPath,
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

function findingPassed(receipt: MigrationVerifyReceipt, check: string): boolean {
  return receipt.findings.some((row) => row.check === check && row.outcome === "passed");
}

export function migrationReceiptToEvidence(
  value: unknown,
): VerifiedMigrationReceiptEvidence | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === M3_VERIFY_RECEIPT_KIND) {
    const receipt = value as unknown as MigrationVerifyReceipt;
    if (!receipt.receiptId || !receipt.resourceId) {
      return null;
    }
    return {
      receiptId: receipt.receiptId,
      resourceId: receipt.resourceId,
      tenantId: receipt.tenantId,
      passed: receipt.passed,
      artifactIdentityVerified:
        findingPassed(receipt, "catalog_binding") || findingPassed(receipt, "ownership_tenant"),
      integrityVerified: findingPassed(receipt, "checksum"),
    };
  }
  if (value.kind === MIGRATION_RECEIPT_KIND) {
    // An apply receipt is not enough by itself: identity and integrity still
    // have to be verified. Surface it as incomplete evidence so the classifier
    // waits for a verify receipt rather than auto-continuing.
    const receiptId = typeof value.receiptId === "string" ? value.receiptId : "";
    const resourceId = typeof value.resourceId === "string" ? value.resourceId : "";
    if (!receiptId || !resourceId) {
      return null;
    }
    return {
      receiptId,
      resourceId,
      tenantId: typeof value.tenantId === "string" ? value.tenantId : undefined,
      passed: value.status === "migrated",
      fromLocator: typeof value.previousLocator === "string" ? value.previousLocator : undefined,
      toBindingId:
        typeof value.canonicalBindingId === "string" ? value.canonicalBindingId : undefined,
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
}): VerifiedMigrationReceiptEvidence | null {
  const resourceId = params.resourceId?.trim();
  if (!resourceId) {
    return null;
  }
  const dirs = params.receiptDirs ?? [];
  for (const receiptDir of dirs) {
    const match = listVerifiedMigrationReceipts(receiptDir).find((row) => {
      if (row.resourceId !== resourceId) {
        return false;
      }
      if (params.tenantId && row.tenantId && row.tenantId !== params.tenantId) {
        return false;
      }
      return true;
    });
    if (match) {
      return match;
    }
  }
  return null;
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
    });
  } catch {
    // Missing receipt directories mean the migration is not verified.
  }
  return evidence;
}
