/**
 * M1 identity / ownership dry-run. Signed plan only. Zero writes.
 * resourceId is emitted only after a live ownership proof succeeds.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  computeInventoryChecksum,
  type MigrationCandidate,
  type MigrationDisposition,
  type MigrationInventoryReport,
  type MigrationInventoryResourceType,
  type MigrationOwnerScope,
} from "./migration-inventory.js";
import type { OwnershipPrincipal } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

export const MIGRATION_PLAN_SCHEMA_VERSION = 1 as const;
export const MIGRATION_PLAN_KIND = "m1_identity_dry_run" as const;

export type MigrationPlanAction = "reuse_identity" | "assign_identity" | "quarantine" | "block";

export type MigrationPlanReason =
  | "identity_reused"
  | "identity_assigned"
  | "proof_required"
  | "proof_owner_mismatch"
  | "proof_tenant_mismatch"
  | "missing_candidate_tenant"
  | "shared_agent_forbidden"
  | "owner_scope_forbidden"
  | "quarantine_disposition"
  | "not_identity_subject"
  | "cross_tenant"
  | "later_wave_adapter_locked"
  | "inventory_checksum_mismatch"
  | "caller_tenant_mismatch"
  | "signing_key_required";

export type MigrationPlanEntry = {
  candidateId: string;
  resourceType: MigrationInventoryResourceType;
  sourceLocator: string;
  tenantId: string | null;
  action: MigrationPlanAction;
  resourceId: string | null;
  ownerScope: MigrationOwnerScope | null;
  owner: OwnershipPrincipal | null;
  reasonCode: MigrationPlanReason;
};

export type MigrationPlanPayload = {
  kind: typeof MIGRATION_PLAN_KIND;
  schemaVersion: typeof MIGRATION_PLAN_SCHEMA_VERSION;
  callerTenantId: string;
  inventoryChecksum: string;
  writes: 0;
  entries: MigrationPlanEntry[];
};

export type SignedMigrationPlan = MigrationPlanPayload & {
  planChecksum: string;
  signature: string;
  keyRefId: string;
};

export type PlanMigrationIdentitiesParams = {
  inventory: MigrationInventoryReport;
  callerTenantId: string;
  proofs: Readonly<Record<string, GovernanceOwnershipProof | undefined>>;
  signingKey: string;
  keyRefId?: string;
};

const IDENTITY_TYPES = new Set<MigrationInventoryResourceType>([
  "workspace",
  "agent",
  "conversation_archive",
  "knowledge",
  "memory",
  "operational_identity",
]);

const QUARANTINE_DISPOSITIONS = new Set<MigrationDisposition>([
  "unknown",
  "duplicate",
  "conflict",
  "orphan",
  "tombstoned",
]);

const APPROVED_SYSTEM_IDS = new Set(["enterprise-oi"]);

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ownerScopeFromProof(proof: GovernanceOwnershipProof): MigrationOwnerScope | null {
  switch (proof.owner.kind) {
    case "user":
      return "user_owned";
    case "position":
      return "position_owned";
    case "group":
      return "group_owned";
    case "system":
      return "system";
  }
}

function ownerKey(owner: OwnershipPrincipal): string {
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

function proofBoundToCallerTenant(
  proof: GovernanceOwnershipProof,
  callerTenantId: string,
): boolean {
  if (proof.owner.kind === "group") {
    return (
      proof.scope.kind === "tenant" &&
      proof.scope.tenantId === callerTenantId &&
      Boolean(proof.owner.groupId.trim())
    );
  }
  if (proof.scope.kind === "tenant") {
    return proof.scope.tenantId === callerTenantId;
  }
  return false;
}

function isSharedAgentShortcut(proof: GovernanceOwnershipProof): boolean {
  if (proof.owner.kind !== "system") {
    return false;
  }
  return !APPROVED_SYSTEM_IDS.has(proof.owner.systemId) || proof.scope.kind !== "tenant";
}

function ownerScopeAllowed(proof: GovernanceOwnershipProof): boolean {
  if (proof.owner.kind === "system") {
    return APPROVED_SYSTEM_IDS.has(proof.owner.systemId) && proof.scope.kind === "tenant";
  }
  return (
    proof.owner.kind === "user" || proof.owner.kind === "position" || proof.owner.kind === "group"
  );
}

function quarantineEntry(
  candidate: MigrationCandidate,
  reasonCode: MigrationPlanReason,
  action: Exclude<MigrationPlanAction, "reuse_identity" | "assign_identity"> = "quarantine",
): MigrationPlanEntry {
  return {
    candidateId: candidate.candidateId,
    resourceType: candidate.resourceType,
    sourceLocator: candidate.sourceLocator,
    tenantId: candidate.tenantId,
    action,
    resourceId: null,
    ownerScope: null,
    owner: null,
    reasonCode,
  };
}

function classifyEntry(
  candidate: MigrationCandidate,
  params: { callerTenantId: string; proof: GovernanceOwnershipProof | undefined },
): MigrationPlanEntry {
  if (!IDENTITY_TYPES.has(candidate.resourceType)) {
    return quarantineEntry(candidate, "not_identity_subject", "block");
  }
  if (candidate.conflictCode === "later_wave_adapter_locked") {
    return quarantineEntry(candidate, "later_wave_adapter_locked", "block");
  }
  if (candidate.conflictCode === "shared_agent_forbidden") {
    return quarantineEntry(candidate, "shared_agent_forbidden", "block");
  }
  const candidateTenantId = candidate.tenantId?.trim() ?? "";
  if (!candidateTenantId) {
    return quarantineEntry(candidate, "missing_candidate_tenant", "block");
  }
  if (candidateTenantId !== params.callerTenantId) {
    return quarantineEntry(candidate, "cross_tenant", "block");
  }
  if (QUARANTINE_DISPOSITIONS.has(candidate.disposition)) {
    return quarantineEntry(candidate, "quarantine_disposition");
  }

  const proof = params.proof;
  if (!proof) {
    return quarantineEntry(candidate, "proof_required", "block");
  }
  if (isSharedAgentShortcut(proof)) {
    return quarantineEntry(candidate, "shared_agent_forbidden", "block");
  }
  if (!ownerScopeAllowed(proof)) {
    return quarantineEntry(candidate, "owner_scope_forbidden", "block");
  }
  if (!proofBoundToCallerTenant(proof, params.callerTenantId)) {
    return quarantineEntry(candidate, "proof_tenant_mismatch", "block");
  }

  if (candidate.ownershipEvidence.owner) {
    if (ownerKey(proof.owner) !== ownerKey(candidate.ownershipEvidence.owner)) {
      return quarantineEntry(candidate, "proof_owner_mismatch", "block");
    }
  }

  const ownerScope = ownerScopeFromProof(proof);
  if (candidate.disposition === "already_governed") {
    const resourceId = candidate.proposedResourceId;
    if (!resourceId) {
      return quarantineEntry(candidate, "proof_required", "block");
    }
    return {
      candidateId: candidate.candidateId,
      resourceType: candidate.resourceType,
      sourceLocator: candidate.sourceLocator,
      tenantId: candidateTenantId,
      action: "reuse_identity",
      resourceId,
      ownerScope,
      owner: proof.owner,
      reasonCode: "identity_reused",
    };
  }

  if (candidate.disposition === "owned") {
    const resourceId = candidate.proposedResourceId;
    if (!resourceId) {
      return quarantineEntry(candidate, "proof_required", "block");
    }
    return {
      candidateId: candidate.candidateId,
      resourceType: candidate.resourceType,
      sourceLocator: candidate.sourceLocator,
      tenantId: candidateTenantId,
      action: "assign_identity",
      resourceId,
      ownerScope,
      owner: proof.owner,
      reasonCode: "identity_assigned",
    };
  }

  return quarantineEntry(candidate, "quarantine_disposition");
}

function canonicalPayload(payload: MigrationPlanPayload): string {
  return JSON.stringify(payload);
}

export function computePlanChecksum(payload: MigrationPlanPayload): string {
  return sha256Hex(canonicalPayload(payload));
}

function signPlan(payload: MigrationPlanPayload, signingKey: string): string {
  return createHmac("sha256", signingKey).update(canonicalPayload(payload)).digest("base64url");
}

function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Build a signed M1 plan. Does not write Catalog, receipts, or paths. */
export function planMigrationIdentities(params: PlanMigrationIdentitiesParams):
  | { ok: true; plan: SignedMigrationPlan }
  | {
      ok: false;
      reasonCode: Extract<
        MigrationPlanReason,
        "inventory_checksum_mismatch" | "caller_tenant_mismatch" | "signing_key_required"
      >;
    } {
  const callerTenantId = params.callerTenantId.trim();
  const signingKey = params.signingKey.trim();
  if (!signingKey) {
    return { ok: false, reasonCode: "signing_key_required" };
  }
  if (!callerTenantId || callerTenantId !== params.inventory.callerTenantId) {
    return { ok: false, reasonCode: "caller_tenant_mismatch" };
  }
  const expectedChecksum = computeInventoryChecksum({
    callerTenantId: params.inventory.callerTenantId,
    candidates: params.inventory.candidates,
  });
  if (expectedChecksum !== params.inventory.inventoryChecksum) {
    return { ok: false, reasonCode: "inventory_checksum_mismatch" };
  }

  const entries = params.inventory.candidates
    .map((candidate) =>
      classifyEntry(candidate, {
        callerTenantId,
        proof: params.proofs[candidate.candidateId],
      }),
    )
    .toSorted((a, b) => a.candidateId.localeCompare(b.candidateId));

  const payload: MigrationPlanPayload = {
    kind: MIGRATION_PLAN_KIND,
    schemaVersion: MIGRATION_PLAN_SCHEMA_VERSION,
    callerTenantId,
    inventoryChecksum: params.inventory.inventoryChecksum,
    writes: 0,
    entries,
  };
  const planChecksum = computePlanChecksum(payload);
  return {
    ok: true,
    plan: {
      ...payload,
      planChecksum,
      signature: signPlan(payload, signingKey),
      keyRefId: params.keyRefId?.trim() || `mig-plan:${callerTenantId}`,
    },
  };
}

export function verifyMigrationPlan(params: { plan: SignedMigrationPlan; signingKey: string }):
  | { ok: true }
  | {
      ok: false;
      reasonCode: "signing_key_required" | "plan_checksum_mismatch" | "signature_invalid";
    } {
  const signingKey = params.signingKey.trim();
  if (!signingKey) {
    return { ok: false, reasonCode: "signing_key_required" };
  }
  const payload: MigrationPlanPayload = {
    kind: params.plan.kind,
    schemaVersion: params.plan.schemaVersion,
    callerTenantId: params.plan.callerTenantId,
    inventoryChecksum: params.plan.inventoryChecksum,
    writes: params.plan.writes,
    entries: params.plan.entries,
  };
  if (computePlanChecksum(payload) !== params.plan.planChecksum) {
    return { ok: false, reasonCode: "plan_checksum_mismatch" };
  }
  const expected = signPlan(payload, signingKey);
  if (!signaturesMatch(expected, params.plan.signature)) {
    return { ok: false, reasonCode: "signature_invalid" };
  }
  return { ok: true };
}

/** Quarantine / block rows must never carry a resourceId. */
export function planMustNotAssignId(entry: MigrationPlanEntry): boolean {
  if (entry.action === "reuse_identity" || entry.action === "assign_identity") {
    return false;
  }
  return entry.resourceId === null;
}
