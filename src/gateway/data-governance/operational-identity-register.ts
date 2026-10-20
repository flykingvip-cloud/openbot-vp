/**
 * P1-2-c Operational Identity Envelope + AgentAsset continuity references.
 * Catalog never stores credentials / OAuth tokens / secret blobs — handle refs only.
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

/** Allowed handle/ref keys (never secret material). */
const ALLOWED_REF_KEYS = new Set([
  "identityId",
  "provider",
  "credentialHandleId",
  "credentialBindingId",
  "agentAssetId",
]);

/** Forbidden projection keys — secrets must stay in dedicated secret stores. */
const FORBIDDEN_PROJECTION_KEYS = new Set([
  "secret",
  "secrets",
  "token",
  "accessToken",
  "refreshToken",
  "password",
  "apiKey",
  "privateKey",
  "credential",
  "credentials",
  "smtpPassword",
  "clientSecret",
]);

function assertSafeId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SAFE_ID.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`governance_oi_invalid:${label}`);
  }
  return trimmed;
}

export function assertNoSecretProjection(projection: Record<string, string | null>): void {
  for (const key of Object.keys(projection)) {
    if (!ALLOWED_REF_KEYS.has(key)) {
      if (FORBIDDEN_PROJECTION_KEYS.has(key) || /secret|token|password|credential/i.test(key)) {
        throw new Error(`governance_oi_secret_forbidden:${key}`);
      }
    }
    const value = projection[key];
    if (typeof value === "string" && /^(sk-|Bearer |-----BEGIN )/i.test(value)) {
      throw new Error(`governance_oi_secret_forbidden:value:${key}`);
    }
  }
}

export function buildOperationalIdentityResourceId(params: {
  tenantId: string | null;
  identityId: string;
}): string {
  const tenant = params.tenantId ? assertSafeId(params.tenantId, "tenantId") : "local";
  const identityId = assertSafeId(params.identityId, "identityId");
  return `operational_identity:${tenant}:${identityId}`;
}

/**
 * Continuity manifest fragment: references only — never copies Persona/Capability/OI secrets.
 * Agent registry remains AgentAsset SoT; Catalog OI row remains OI metadata SoT.
 */
export type AgentAssetContinuityRefs = {
  agentAssetId: string;
  operationalIdentityResourceId: string;
  /** Optional additional governed resource refs (capability/persona versions later). */
  relatedResourceIds?: string[];
};

// resourceId contains colons — dedicated validator (not SAFE_ID).
function assertContinuityResourceId(value: string): string {
  const trimmed = value.trim();
  if (
    !trimmed.startsWith("operational_identity:") ||
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.length > 256
  ) {
    throw new Error("governance_oi_invalid:operationalIdentityResourceId");
  }
  return trimmed;
}

export function linkOperationalIdentityToAgentAsset(params: {
  agentAssetId: string;
  operationalIdentityResourceId: string;
  relatedResourceIds?: string[];
}): AgentAssetContinuityRefs {
  return {
    agentAssetId: assertSafeId(params.agentAssetId, "agentAssetId"),
    operationalIdentityResourceId: assertContinuityResourceId(params.operationalIdentityResourceId),
    relatedResourceIds: params.relatedResourceIds,
  };
}

/** @deprecated alias — prefer linkOperationalIdentityToAgentAsset */
export const buildAgentAssetContinuityRefs = linkOperationalIdentityToAgentAsset;

export type BeginOperationalIdentityGovernanceParams = {
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  classification?: DataClassification;
  identityId: string;
  /** Metadata-store locator (never the secrets file). */
  canonicalLocator: string;
  storageKind?: StorageBinding["storageKind"];
  provider?: string | null;
  /** Handle ref only — never the secret material. */
  credentialHandleId?: string | null;
  /** Continuity pointer into Agent registry. */
  agentAssetId?: string | null;
  stateDir?: string;
};

export async function beginOperationalIdentityGovernanceRegistration(
  params: BeginOperationalIdentityGovernanceParams,
): Promise<{ resourceId: string; continuity?: AgentAssetContinuityRefs }> {
  assertManagedCreateTenant({
    tenantId: params.tenantId,
    scopeKind: params.scope.kind,
  });
  const resourceId = buildOperationalIdentityResourceId({
    tenantId: params.tenantId,
    identityId: params.identityId,
  });
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(resourceId);
  if (existing) {
    if (
      existing.envelope.lifecycleState === "pending" ||
      existing.envelope.lifecycleState === "active"
    ) {
      const continuity = params.agentAssetId
        ? linkOperationalIdentityToAgentAsset({
            agentAssetId: params.agentAssetId,
            operationalIdentityResourceId: resourceId,
          })
        : undefined;
      return { resourceId, continuity };
    }
    throw new Error(`governance_oi_exists:${existing.envelope.lifecycleState}`);
  }

  const projection: Record<string, string | null> = {
    identityId: assertSafeId(params.identityId, "identityId"),
    provider: params.provider ?? null,
    credentialHandleId: params.credentialHandleId
      ? assertSafeId(params.credentialHandleId, "credentialHandleId")
      : null,
    agentAssetId: params.agentAssetId ? assertSafeId(params.agentAssetId, "agentAssetId") : null,
  };
  assertNoSecretProjection(projection);

  const now = new Date().toISOString();
  const bindingId = `canonical:${resourceId}`;
  const bindings: StorageBinding[] = [
    {
      bindingId,
      resourceId,
      role: "canonical",
      storageKind: params.storageKind ?? "filesystem",
      locator: path.resolve(params.canonicalLocator),
      state: "active",
      contentVersion: "1",
      objectKey: resourceId,
    },
  ];

  const record: CatalogRecord = {
    envelope: {
      resourceId,
      resourceType: "operational_identity",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: params.tenantId,
      owner: params.owner,
      scope: params.scope,
      lifecycleState: "pending",
      classification: params.classification ?? "restricted",
      governanceVersion: 1,
      canonicalBindingId: bindingId,
      createdAt: now,
      updatedAt: now,
      projection,
    },
    bindings,
  };
  await catalog.put(record);

  const continuity = params.agentAssetId
    ? linkOperationalIdentityToAgentAsset({
        agentAssetId: params.agentAssetId,
        operationalIdentityResourceId: resourceId,
      })
    : undefined;

  return { resourceId, continuity };
}

export async function activateOperationalIdentityGovernanceRegistration(params: {
  resourceId: string;
  stateDir?: string;
}): Promise<void> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing || existing.envelope.resourceType !== "operational_identity") {
    throw new Error("governance_oi_missing");
  }
  if (existing.envelope.lifecycleState === "active") {
    return;
  }
  if (existing.envelope.lifecycleState !== "pending") {
    throw new Error(`governance_oi_not_pending:${existing.envelope.lifecycleState}`);
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

export async function abortOperationalIdentityGovernanceRegistration(params: {
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
  if (!existing || existing.envelope.resourceType !== "operational_identity") {
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
      stage: "oi_abort",
      reason: params.reason,
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
  }

  return { recoveryRequired, quarantine };
}

/** Content-write fail-closed gate for Operational Identity metadata mutations. */
export async function requireOperationalIdentityContentWrite(params: {
  resourceId: string;
  callerTenantId: string | null;
  profile: GovernanceWriteProfile;
  ownershipProof?: Parameters<typeof requireGovernedContentWrite>[0]["ownershipProof"];
  allowMissingCatalog?: boolean;
  stateDir?: string;
}): Promise<CatalogRecord | null> {
  return requireGovernedContentWrite({
    resourceId: params.resourceId,
    resourceType: "operational_identity",
    callerTenantId: params.callerTenantId,
    profile: params.profile,
    ownershipProof: params.ownershipProof,
    allowMissingCatalog: params.allowMissingCatalog,
    stateDir: params.stateDir,
  });
}

export type OperationalIdentityWriteSession =
  | { mode: "personal_or_active"; resourceId: string }
  | { mode: "create_pending"; resourceId: string; operationId: string };

/**
 * Managed create/update session for OI metadata.
 * User-owned and tenant-owned (enterprise) streams both use this; callers inject trusted proof.
 */
export async function prepareOperationalIdentityWriteSession(params: {
  tenantId: string | null;
  identityId: string;
  canonicalLocator: string;
  ownershipProof?: GovernanceOwnershipProof;
  provider?: string | null;
  credentialHandleId?: string | null;
  agentAssetId?: string | null;
  stateDir?: string;
}): Promise<OperationalIdentityWriteSession> {
  const managed = Boolean(params.tenantId?.trim());
  const resourceId = buildOperationalIdentityResourceId({
    tenantId: params.tenantId,
    identityId: params.identityId,
  });
  if (managed) {
    if (!params.ownershipProof) {
      throw new Error("governance_write_denied:missing_ownership_proof");
    }
    const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
    const existing = await catalog.get(resourceId);
    if (existing?.envelope.lifecycleState === "active") {
      await requireOperationalIdentityContentWrite({
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
        operationId: `oi-create-${params.identityId}`.slice(0, 120),
      };
    }
    await beginOperationalIdentityGovernanceRegistration({
      stateDir: params.stateDir,
      tenantId: params.tenantId,
      owner: params.ownershipProof.owner,
      scope: params.ownershipProof.scope,
      identityId: params.identityId,
      canonicalLocator: params.canonicalLocator,
      provider: params.provider,
      credentialHandleId: params.credentialHandleId,
      agentAssetId: params.agentAssetId ?? params.ownershipProof.agentAssetId,
    });
    const operationId = `oi-create-${params.identityId}`.slice(0, 120);
    writeGovernanceLogicalOpMarker({
      stateDir: params.stateDir ?? resolveStateDir(),
      operationId,
      resourceId,
      resourceType: "operational_identity",
      locator: params.canonicalLocator,
      objectKey: resourceId,
    });
    return {
      mode: "create_pending",
      resourceId,
      operationId,
    };
  }
  await requireOperationalIdentityContentWrite({
    resourceId,
    callerTenantId: params.tenantId,
    profile: "personal_local",
    ownershipProof: params.ownershipProof,
    allowMissingCatalog: true,
    stateDir: params.stateDir,
  });
  return { mode: "personal_or_active", resourceId };
}

export async function finalizeOperationalIdentityWriteSession(params: {
  session: OperationalIdentityWriteSession;
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
    await activateOperationalIdentityGovernanceRegistration({
      resourceId: params.session.resourceId,
      stateDir: params.stateDir,
    });
    return;
  }
  await abortOperationalIdentityGovernanceRegistration({
    resourceId: params.session.resourceId,
    reason: params.reason ?? "oi_create_failed",
    operationId: params.session.operationId,
    allowedRoots: params.allowedRoots,
    stateDir: params.stateDir,
    finalizeLifecycle: "recovery_required",
    logicalCompensate: params.logicalCompensate,
  });
}
