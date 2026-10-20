/**
 * P1-2-a Knowledge Asset governance registration.
 * Grain freeze: document version OR enterprise projection; KB=container; index=derived/cache.
 */

import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { compensateKnowledgeVersionWrite } from "./logical-compensate.js";
import { runManagedGovernedCreateTxn } from "./managed-create-txn.js";
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
  KnowledgeContentClass,
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
    throw new Error(`governance_knowledge_invalid:${label}`);
  }
  return trimmed;
}

export function buildKnowledgeResourceId(params: {
  tenantId: string | null;
  contentClass: KnowledgeContentClass;
  docId?: string;
  versionId?: string;
  projectionId?: string;
}): string {
  const tenant = params.tenantId ? assertSafeId(params.tenantId, "tenantId") : "local";
  if (params.contentClass === "document_version") {
    const docId = assertSafeId(params.docId ?? "", "docId");
    const versionId = assertSafeId(params.versionId ?? "", "versionId");
    return `knowledge:${tenant}:doc:${docId}:${versionId}`;
  }
  const projectionId = assertSafeId(params.projectionId ?? "", "projectionId");
  return `knowledge:${tenant}:projection:${projectionId}`;
}

export type BeginKnowledgeGovernanceParams = {
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  classification?: DataClassification;
  contentClass: KnowledgeContentClass;
  /** Canonical storage locator (metadata binding only — not content body). */
  canonicalLocator: string;
  storageKind?: StorageBinding["storageKind"];
  kbId?: string | null;
  docId?: string;
  versionId?: string;
  projectionId?: string;
  sourceBindingRef?: string | null;
  /** Optional derived/cache index locator (never canonical). */
  indexLocator?: string | null;
  stateDir?: string;
};

/** Content-write fail-closed gate for Knowledge Asset mutations. */
export async function requireKnowledgeContentWrite(params: {
  resourceId: string;
  callerTenantId: string | null;
  profile: GovernanceWriteProfile;
  ownershipProof?: Parameters<typeof requireGovernedContentWrite>[0]["ownershipProof"];
  allowMissingCatalog?: boolean;
  stateDir?: string;
}): Promise<CatalogRecord | null> {
  return requireGovernedContentWrite({
    resourceId: params.resourceId,
    resourceType: "knowledge",
    callerTenantId: params.callerTenantId,
    profile: params.profile,
    ownershipProof: params.ownershipProof,
    allowMissingCatalog: params.allowMissingCatalog,
    stateDir: params.stateDir,
  });
}

export async function beginKnowledgeGovernanceRegistration(
  params: BeginKnowledgeGovernanceParams,
): Promise<{ resourceId: string }> {
  assertManagedCreateTenant({
    tenantId: params.tenantId,
    scopeKind: params.scope.kind,
  });
  const resourceId = buildKnowledgeResourceId(params);
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(resourceId);
  if (existing) {
    if (
      existing.envelope.lifecycleState === "pending" ||
      existing.envelope.lifecycleState === "active"
    ) {
      return { resourceId };
    }
    throw new Error(`governance_knowledge_exists:${existing.envelope.lifecycleState}`);
  }

  const now = new Date().toISOString();
  const bindingId = `canonical:${resourceId}`;
  const projection: Record<string, string | null> = {
    contentClass: params.contentClass,
    kbId: params.kbId ?? null,
    docId: params.docId ?? null,
    versionId: params.versionId ?? null,
    projectionId: params.projectionId ?? null,
    sourceBindingRef: params.sourceBindingRef ?? null,
  };

  const bindings: StorageBinding[] = [
    {
      bindingId,
      resourceId,
      role: "canonical",
      storageKind: params.storageKind ?? "filesystem",
      locator: path.resolve(params.canonicalLocator),
      state: "active",
      contentVersion: "1",
      // Shared KB SQLite aggregate — uniqueness is locator + objectKey.
      objectKey: resourceId,
    },
  ];
  if (params.indexLocator) {
    bindings.push({
      bindingId: `derived-index:${resourceId}`,
      resourceId,
      role: "derived",
      storageKind: "sqlite",
      locator: path.resolve(params.indexLocator),
      state: "active",
      contentVersion: "1",
      objectKey: resourceId,
    });
  }

  const record: CatalogRecord = {
    envelope: {
      resourceId,
      resourceType: "knowledge",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: params.tenantId,
      owner: params.owner,
      scope: params.scope,
      lifecycleState: "pending",
      classification: params.classification ?? "internal",
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

export async function activateKnowledgeGovernanceRegistration(params: {
  resourceId: string;
  stateDir?: string;
}): Promise<void> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing || existing.envelope.resourceType !== "knowledge") {
    throw new Error("governance_knowledge_missing");
  }
  if (existing.envelope.lifecycleState === "active") {
    return;
  }
  if (existing.envelope.lifecycleState !== "pending") {
    throw new Error(`governance_knowledge_not_pending:${existing.envelope.lifecycleState}`);
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

export async function abortKnowledgeGovernanceRegistration(params: {
  resourceId: string;
  reason: string;
  operationId: string;
  allowedRoots: string[];
  stateDir?: string;
  finalizeLifecycle?: "quarantined" | "recovery_required";
  /** Prefer logical compensate for shared KB aggregates. */
  logicalCompensate?: () => Promise<{ ok: boolean; detail?: string }>;
}): Promise<{ recoveryRequired: boolean; quarantine?: QuarantinePathResult }> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing || existing.envelope.resourceType !== "knowledge") {
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
    const docId = existing.envelope.projection?.docId;
    const versionId = existing.envelope.projection?.versionId;
    let logicalOk = false;
    if (params.logicalCompensate) {
      const result = await params.logicalCompensate();
      logicalOk = result.ok;
    } else if (canonical && docId && versionId) {
      const result = await compensateKnowledgeVersionWrite({
        dbPath: canonical.locator,
        docId,
        versionId,
      });
      logicalOk = result.ok;
    }
    quarantine = logicalOk
      ? { status: "skipped", reason: "shared_aggregate_logical_compensate" }
      : {
          status: "failed",
          error: "shared_aggregate_logical_compensate_failed",
        };
  } else if (canonical) {
    writeGovernanceOpMarker({
      targetPath: canonical.locator,
      operationId: params.operationId,
      kind: "file",
    });
    quarantine = await quarantinePath({
      targetPath: canonical.locator,
      reason: params.reason,
      stateDir: params.stateDir,
      operationId: params.operationId,
      kind: "file",
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
      stage: "knowledge_abort",
      reason: params.reason,
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
  }

  return { recoveryRequired, quarantine };
}

export type KnowledgeWriteSession =
  | { mode: "personal_or_active"; resourceId: string }
  | { mode: "create_pending"; resourceId: string; operationId: string };

/**
 * Managed: require trusted ownershipProof from call entry.
 * - active Catalog → gate only
 * - missing Catalog → begin pending (caller must activate after physical write, or abort on failure)
 * Personal: allowMissingCatalog with optional proof.
 */
export async function prepareKnowledgeContentWriteSession(params: {
  tenantId: string | null;
  docId: string;
  versionId: string;
  kbId?: string | null;
  canonicalLocator: string;
  /** Trusted proof from authenticated call entry — required for managed. */
  ownershipProof?: GovernanceOwnershipProof;
  stateDir?: string;
  indexLocator?: string | null;
}): Promise<KnowledgeWriteSession> {
  const managed = Boolean(params.tenantId?.trim());
  const resourceId = buildKnowledgeResourceId({
    tenantId: params.tenantId,
    contentClass: "document_version",
    docId: params.docId,
    versionId: params.versionId,
  });

  if (managed) {
    if (!params.ownershipProof) {
      throw new Error("governance_write_denied:missing_ownership_proof");
    }
    const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
    const existing = await catalog.get(resourceId);
    if (existing?.envelope.lifecycleState === "active") {
      await requireKnowledgeContentWrite({
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
        operationId: `knowledge-create-${params.versionId}`,
      };
    }
    await beginKnowledgeGovernanceRegistration({
      stateDir: params.stateDir,
      tenantId: params.tenantId,
      owner: params.ownershipProof.owner,
      scope: params.ownershipProof.scope,
      contentClass: "document_version",
      docId: params.docId,
      versionId: params.versionId,
      kbId: params.kbId,
      canonicalLocator: params.canonicalLocator,
      indexLocator: params.indexLocator,
    });
    const operationId = `knowledge-create-${params.versionId}`;
    writeGovernanceLogicalOpMarker({
      stateDir: params.stateDir ?? resolveStateDir(),
      operationId,
      resourceId,
      resourceType: "knowledge",
      locator: params.canonicalLocator,
      objectKey: resourceId,
    });
    return {
      mode: "create_pending",
      resourceId,
      operationId,
    };
  }

  await requireKnowledgeContentWrite({
    resourceId,
    callerTenantId: params.tenantId,
    profile: "personal_local",
    ownershipProof: params.ownershipProof,
    allowMissingCatalog: true,
    stateDir: params.stateDir,
  });
  return { mode: "personal_or_active", resourceId };
}

export async function finalizeKnowledgeContentWriteSession(params: {
  session: KnowledgeWriteSession;
  ok: boolean;
  reason?: string;
  stateDir?: string;
  allowedRoots: string[];
}): Promise<void> {
  if (params.session.mode !== "create_pending") {
    return;
  }
  if (params.ok) {
    await activateKnowledgeGovernanceRegistration({
      resourceId: params.session.resourceId,
      stateDir: params.stateDir,
    });
    return;
  }
  await abortKnowledgeGovernanceRegistration({
    resourceId: params.session.resourceId,
    reason: params.reason ?? "knowledge_create_failed",
    operationId: params.session.operationId,
    allowedRoots: params.allowedRoots,
    stateDir: params.stateDir,
    finalizeLifecycle: "recovery_required",
  });
}

/** Test/helper wrapper using runManagedGovernedCreateTxn. */
export async function runKnowledgeManagedCreateWrite<T>(params: {
  tenantId: string;
  ownershipProof: GovernanceOwnershipProof;
  docId: string;
  versionId: string;
  kbId?: string | null;
  canonicalLocator: string;
  stateDir?: string;
  allowedRoots: string[];
  write: () => Promise<T>;
}): Promise<T> {
  const result = await runManagedGovernedCreateTxn({
    operationId: `knowledge-create-${params.versionId}`,
    beginPending: async () =>
      beginKnowledgeGovernanceRegistration({
        stateDir: params.stateDir,
        tenantId: params.tenantId,
        owner: params.ownershipProof.owner,
        scope: params.ownershipProof.scope,
        contentClass: "document_version",
        docId: params.docId,
        versionId: params.versionId,
        kbId: params.kbId,
        canonicalLocator: params.canonicalLocator,
      }),
    physicalWrite: async () => params.write(),
    activate: async ({ resourceId }) =>
      activateKnowledgeGovernanceRegistration({
        resourceId,
        stateDir: params.stateDir,
      }),
    abort: async ({ resourceId, operationId, reason }) =>
      abortKnowledgeGovernanceRegistration({
        resourceId,
        operationId,
        reason,
        allowedRoots: params.allowedRoots,
        stateDir: params.stateDir,
        finalizeLifecycle: "recovery_required",
      }),
  });
  if (!result.ok) {
    throw new Error(`governance_knowledge_create_failed:${result.error}`);
  }
  return result.value;
}
