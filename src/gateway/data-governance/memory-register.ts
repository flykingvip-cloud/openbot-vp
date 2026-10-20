/**
 * P1-2-b Memory Asset governance registration.
 * Canonical freeze: Managed = CogniWeave only; Personal Local may use Markdown root.
 * Catalog stores minimal identity projection only — never atom bodies / embeddings.
 */

import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { writeGovernanceLogicalOpMarker, writeGovernanceOpMarker } from "./operation-marker.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import {
  getSharedDataGovernanceCatalog,
  quarantinePath,
  type QuarantinePathResult,
} from "./runtime-catalog.js";
import type {
  CatalogRecord,
  DataClassification,
  MemoryCanonicalKind,
  OwnershipPrincipal,
  ResourceScope,
  StorageBinding,
} from "./types.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";
import {
  assertManagedCreateTenant,
  assertOwnershipProofMatches,
  requireGovernedContentWrite,
  type GovernanceOwnershipProof,
  type GovernanceWriteProfile,
} from "./write-gate.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertSafeId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SAFE_ID.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`governance_memory_invalid:${label}`);
  }
  return trimmed;
}

export type SecurityProfileKind = "personal_local" | "managed_enterprise";

export function assertMemoryCanonicalAllowed(params: {
  profile: SecurityProfileKind;
  canonicalKind: MemoryCanonicalKind;
}): void {
  if (params.profile === "managed_enterprise" && params.canonicalKind !== "cogniweave") {
    throw new Error("governance_memory_canonical_denied:managed_requires_cogniweave");
  }
}

export function buildMemoryResourceId(params: {
  tenantId: string | null;
  atomId?: string | null;
  /** Stable source id when registering a markdown-root or store-level asset. */
  sourceId: string;
}): string {
  const tenant = params.tenantId ? assertSafeId(params.tenantId, "tenantId") : "local";
  if (params.atomId) {
    return `memory:${tenant}:atom:${assertSafeId(params.atomId, "atomId")}`;
  }
  return `memory:${tenant}:source:${assertSafeId(params.sourceId, "sourceId")}`;
}

/**
 * Stable CogniWeave source grain: visibility + workspace + agent (not a shared tenant-wide id).
 */
export function buildCogniWeaveMemorySourceId(params: {
  visibility: string;
  workspaceId: string;
  agentId: string;
  projectId?: string;
}): string {
  const visibility = assertSafeId(params.visibility || "private", "visibility");
  const workspaceId = assertSafeId(
    params.workspaceId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 48) || "ws",
    "workspaceId",
  );
  const agentId = assertSafeId(
    params.agentId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64) || "agent",
    "agentId",
  );
  const project = (params.projectId ?? "default").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 32);
  return `cw-${visibility}-${workspaceId}-${agentId}-${project || "default"}`;
}

export type BeginMemoryGovernanceParams = {
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  classification?: DataClassification;
  profile: SecurityProfileKind;
  canonicalKind: MemoryCanonicalKind;
  /** Canonical locator (CogniWeave sqlite path or MEMORY.md / memory root) — metadata only. */
  canonicalLocator: string;
  storageKind?: StorageBinding["storageKind"];
  atomId?: string | null;
  sourceId: string;
  memoryTier?: string | null;
  sourceWorkspaceResourceId?: string | null;
  /** Derived/cache locators (builtin/QMD/LanceDB) — never canonical. */
  derivedLocators?: Array<{
    role: "derived" | "cache";
    locator: string;
    storageKind?: StorageBinding["storageKind"];
  }>;
  stateDir?: string;
};

export async function beginMemoryGovernanceRegistration(
  params: BeginMemoryGovernanceParams,
): Promise<{ resourceId: string }> {
  assertManagedCreateTenant({
    profile: params.profile,
    tenantId: params.tenantId,
    scopeKind: params.scope.kind,
  });
  assertMemoryCanonicalAllowed({
    profile: params.profile,
    canonicalKind: params.canonicalKind,
  });

  const resourceId = buildMemoryResourceId({
    tenantId: params.tenantId,
    atomId: params.atomId,
    sourceId: params.sourceId,
  });
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(resourceId);
  if (existing) {
    if (
      existing.envelope.lifecycleState === "pending" ||
      existing.envelope.lifecycleState === "active"
    ) {
      return { resourceId };
    }
    throw new Error(`governance_memory_exists:${existing.envelope.lifecycleState}`);
  }

  const now = new Date().toISOString();
  const bindingId = `canonical:${resourceId}`;
  const projection: Record<string, string | null> = {
    canonicalKind: params.canonicalKind,
    atomId: params.atomId ?? null,
    sourceId: params.sourceId,
    memoryTier: params.memoryTier ?? null,
    sourceWorkspaceResourceId: params.sourceWorkspaceResourceId ?? null,
  };

  const canonicalStorageKind: StorageBinding["storageKind"] =
    params.storageKind ?? (params.canonicalKind === "cogniweave" ? "sqlite" : "filesystem");

  const bindings: StorageBinding[] = [
    {
      bindingId,
      resourceId,
      role: "canonical",
      storageKind: canonicalStorageKind,
      locator: path.resolve(params.canonicalLocator),
      state: "active",
      contentVersion: "1",
      objectKey: resourceId,
    },
  ];

  let derivedIdx = 0;
  for (const derived of params.derivedLocators ?? []) {
    derivedIdx += 1;
    bindings.push({
      bindingId: `${derived.role}:${resourceId}:${derivedIdx}`,
      resourceId,
      role: derived.role,
      storageKind: derived.storageKind ?? "sqlite",
      locator: path.resolve(derived.locator),
      state: "active",
      contentVersion: "1",
    });
  }

  const record: CatalogRecord = {
    envelope: {
      resourceId,
      resourceType: "memory",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: params.tenantId,
      owner: params.owner,
      scope: params.scope,
      lifecycleState: "pending",
      classification: params.classification ?? "confidential",
      governanceVersion: 1,
      canonicalBindingId: bindingId,
      createdAt: now,
      updatedAt: now,
      projection,
    },
    bindings,
  };
  await catalog.put(record);
  return { resourceId };
}

export async function activateMemoryGovernanceRegistration(params: {
  resourceId: string;
  stateDir?: string;
}): Promise<void> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing || existing.envelope.resourceType !== "memory") {
    throw new Error("governance_memory_missing");
  }
  if (existing.envelope.lifecycleState === "active") {
    return;
  }
  if (existing.envelope.lifecycleState !== "pending") {
    throw new Error(`governance_memory_not_pending:${existing.envelope.lifecycleState}`);
  }
  await catalog.put({
    envelope: {
      ...existing.envelope,
      lifecycleState: "active",
      governanceVersion: existing.envelope.governanceVersion + 1,
      updatedAt: new Date().toISOString(),
    },
    bindings: existing.bindings,
  });
}

export async function abortMemoryGovernanceRegistration(params: {
  resourceId: string;
  reason: string;
  operationId: string;
  allowedRoots: string[];
  stateDir?: string;
  finalizeLifecycle?: "quarantined" | "recovery_required";
  logicalCompensate?: () => Promise<{ ok: boolean; detail?: string }>;
}): Promise<{ recoveryRequired: boolean; quarantine?: QuarantinePathResult }> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing || existing.envelope.resourceType !== "memory") {
    return { recoveryRequired: false };
  }

  await catalog.put({
    envelope: {
      ...existing.envelope,
      lifecycleState: "recovery_required",
      governanceVersion: existing.envelope.governanceVersion + 1,
      updatedAt: new Date().toISOString(),
    },
    bindings: existing.bindings,
  });

  const canonical = existing.bindings.find((b) => b.role === "canonical" && b.state === "active");
  let quarantine: QuarantinePathResult | undefined;
  const sharedAggregate = Boolean(canonical?.objectKey?.trim());

  if (sharedAggregate) {
    let logicalOk = false;
    if (params.logicalCompensate) {
      const result = await params.logicalCompensate();
      logicalOk = result.ok;
    }
    quarantine = logicalOk
      ? { status: "skipped", reason: "shared_aggregate_logical_compensate" }
      : { status: "failed", error: "shared_aggregate_logical_compensate_failed" };
  } else if (canonical) {
    const kind = canonical.storageKind === "filesystem" ? "directory" : "file";
    writeGovernanceOpMarker({
      targetPath: canonical.locator,
      operationId: params.operationId,
      kind,
    });
    quarantine = await quarantinePath({
      targetPath: canonical.locator,
      reason: params.reason,
      stateDir: params.stateDir,
      operationId: params.operationId,
      kind,
      allowedRoots: params.allowedRoots,
    });
  }

  const finalize = params.finalizeLifecycle ?? "quarantined";
  const logicalCompensated = sharedAggregate && quarantine?.status === "skipped";
  const recoveryRequired = logicalCompensated
    ? false
    : finalize === "recovery_required" ||
      !quarantine ||
      quarantine.status === "failed" ||
      quarantine.status === "skipped";

  await catalog.put({
    envelope: {
      ...existing.envelope,
      lifecycleState: recoveryRequired ? "recovery_required" : "quarantined",
      governanceVersion: existing.envelope.governanceVersion + 2,
      updatedAt: new Date().toISOString(),
    },
    bindings: existing.bindings,
  });

  if (recoveryRequired) {
    writeGovernanceRecoveryReceipt({
      operationId: params.operationId,
      stage: "memory_abort",
      reason: params.reason,
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
  }

  return { recoveryRequired, quarantine };
}

/** Content-write fail-closed gate for Memory Asset mutations. */
export async function requireMemoryContentWrite(params: {
  resourceId: string;
  callerTenantId: string | null;
  profile: GovernanceWriteProfile;
  ownershipProof?: Parameters<typeof requireGovernedContentWrite>[0]["ownershipProof"];
  allowMissingCatalog?: boolean;
  stateDir?: string;
}): Promise<CatalogRecord | null> {
  return requireGovernedContentWrite({
    resourceId: params.resourceId,
    resourceType: "memory",
    callerTenantId: params.callerTenantId,
    profile: params.profile,
    ownershipProof: params.ownershipProof,
    allowMissingCatalog: params.allowMissingCatalog,
    stateDir: params.stateDir,
  });
}

export type MemoryWriteSession =
  | { mode: "personal_or_active"; resourceId: string }
  | { mode: "create_pending"; resourceId: string; operationId: string };

export async function prepareMemoryContentWriteSession(params: {
  tenantId: string | null;
  sourceId: string;
  canonicalLocator: string;
  canonicalKind?: MemoryCanonicalKind;
  ownershipProof?: GovernanceOwnershipProof;
  stateDir?: string;
}): Promise<MemoryWriteSession> {
  const managed = Boolean(params.tenantId?.trim());
  const resourceId = buildMemoryResourceId({
    tenantId: params.tenantId,
    sourceId: params.sourceId,
  });
  if (managed) {
    if (!params.ownershipProof) {
      throw new Error("governance_write_denied:missing_ownership_proof");
    }
    const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
    const existing = await catalog.get(resourceId);
    if (existing?.envelope.lifecycleState === "active") {
      await requireMemoryContentWrite({
        resourceId,
        callerTenantId: params.tenantId,
        profile: "managed_enterprise",
        ownershipProof: params.ownershipProof,
        stateDir: params.stateDir,
      });
      return { mode: "personal_or_active", resourceId };
    }
    if (existing?.envelope.lifecycleState === "pending") {
      assertOwnershipProofMatches(existing, params.ownershipProof);
      return {
        mode: "create_pending",
        resourceId,
        operationId: `memory-create-${params.sourceId}`.slice(0, 120),
      };
    }
    await beginMemoryGovernanceRegistration({
      stateDir: params.stateDir,
      tenantId: params.tenantId,
      owner: params.ownershipProof.owner,
      scope: params.ownershipProof.scope,
      profile: "managed_enterprise",
      canonicalKind: params.canonicalKind ?? "cogniweave",
      sourceId: params.sourceId,
      canonicalLocator: params.canonicalLocator,
    });
    const operationId = `memory-create-${params.sourceId}`.slice(0, 120);
    writeGovernanceLogicalOpMarker({
      stateDir: params.stateDir ?? resolveStateDir(),
      operationId,
      resourceId,
      resourceType: "memory",
      locator: params.canonicalLocator,
      objectKey: resourceId,
    });
    return {
      mode: "create_pending",
      resourceId,
      operationId,
    };
  }
  await requireMemoryContentWrite({
    resourceId,
    callerTenantId: params.tenantId,
    profile: "personal_local",
    ownershipProof: params.ownershipProof,
    allowMissingCatalog: true,
    stateDir: params.stateDir,
  });
  return { mode: "personal_or_active", resourceId };
}

export async function finalizeMemoryContentWriteSession(params: {
  session: MemoryWriteSession;
  ok: boolean;
  reason?: string;
  stateDir?: string;
  allowedRoots: string[];
  logicalCompensate?: () => Promise<{ ok: boolean; detail?: string }>;
}): Promise<void> {
  if (params.session.mode !== "create_pending") {
    return;
  }
  if (params.ok) {
    await activateMemoryGovernanceRegistration({
      resourceId: params.session.resourceId,
      stateDir: params.stateDir,
    });
    return;
  }
  await abortMemoryGovernanceRegistration({
    resourceId: params.session.resourceId,
    reason: params.reason ?? "memory_create_failed",
    operationId: params.session.operationId,
    allowedRoots: params.allowedRoots,
    stateDir: params.stateDir,
    finalizeLifecycle: "recovery_required",
    logicalCompensate: params.logicalCompensate,
  });
}
