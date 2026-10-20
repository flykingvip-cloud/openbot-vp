/**
 * Ownership/tenant binding for the P3-f manifest and P3-g anchor pointer stores.
 *
 * An authenticated user is **not** authority to write history under an arbitrary
 * `agentAssetId` / `resourceId`. Both slices therefore resolve the governed subject
 * through the authoritative Catalog row and bind caller tenant + owner scope before any
 * filesystem write. This is deliberately not a second ACL system: the checks reuse
 * `actorMayRepresentOwner` (seat/group occupancy, P3-b) and `assertOwnershipProofMatches`
 * (Catalog envelope proof, P1-2), the same helpers `applyCognitiveMerge` binds with.
 */
import { resolveStateDir } from "../../config/paths.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import type { GovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import type { GovernanceAuthenticatedCall } from "./cognitive-recommendation-auth.js";
import { actorMayRepresentOwner } from "./cognitive-recommendation-registry.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type { AgentAssetContinuityManifest, CatalogRecord } from "./types.js";
import { assertOwnershipProofMatches } from "./write-gate.js";

/** Why a pointer-store command refused to bind its subject. Never leaked as raw text. */
export type PointerOwnershipDenial =
  | "subject_not_found"
  | "tenant_mismatch"
  | "owner_not_represented"
  | "owner_scope_mismatch";

export type PointerOwnershipBinding = {
  record: CatalogRecord;
};

function catalogFor(params: {
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): DataGovernanceCatalogStore {
  if (params.catalog) {
    return params.catalog;
  }
  return getOrCreateFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(params.stateDir ?? resolveStateDir()),
  });
}

/** Registry read. A Catalog outage is a refusal, never an implicit allow. */
async function readSubject(params: {
  resourceId: string;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): Promise<CatalogRecord | null> {
  try {
    return await catalogFor(params).get(params.resourceId);
  } catch {
    return null;
  }
}

/** `AgentAssetContinuityManifest.ownerScope` must agree with the Catalog owner kind. */
export function manifestOwnerScopeFor(
  record: CatalogRecord,
): AgentAssetContinuityManifest["ownerScope"] | null {
  switch (record.envelope.owner.kind) {
    case "user":
      return "user_owned";
    case "position":
      return "position_owned";
    case "group":
      return "group_owned";
    default:
      return null;
  }
}

/**
 * Propose path (user-authenticated, no grant): the caller must be able to represent the
 * Catalog row's owner inside the caller's own tenant partition.
 */
export async function bindUserProposalSubject(params: {
  resourceId: string;
  call: GovernanceAuthenticatedCall;
  /** When set, the request's declared owner scope must match the Catalog owner kind. */
  requiredOwnerScope?: AgentAssetContinuityManifest["ownerScope"];
  /** When set, the Catalog row must carry this governed type (AgentAsset = `agent`). */
  requiredResourceType?: CatalogRecord["envelope"]["resourceType"];
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): Promise<
  { ok: true; binding: PointerOwnershipBinding } | { ok: false; deny: PointerOwnershipDenial }
> {
  const record = await readSubject({
    resourceId: params.resourceId,
    stateDir: params.stateDir,
    catalog: params.catalog,
  });
  if (!record) {
    return { ok: false, deny: "subject_not_found" };
  }
  if (params.requiredResourceType && record.envelope.resourceType !== params.requiredResourceType) {
    return { ok: false, deny: "subject_not_found" };
  }
  if ((record.envelope.tenantId ?? null) !== (params.call.callerTenantId ?? null)) {
    return { ok: false, deny: "tenant_mismatch" };
  }
  const scope = manifestOwnerScopeFor(record);
  if (params.requiredOwnerScope && scope !== params.requiredOwnerScope) {
    return { ok: false, deny: "owner_scope_mismatch" };
  }
  const represents = await actorMayRepresentOwner({
    callerTenantId: params.call.callerTenantId,
    actor: params.call.actor,
    owner: record.envelope.owner,
    stateDir: params.stateDir,
  });
  if (!represents) {
    return { ok: false, deny: "owner_not_represented" };
  }
  return { ok: true, binding: { record } };
}

/**
 * Approve/activate/supersede/revoke path: re-bind the branded grant to the actual Catalog
 * row (never trust mint-time `requiredScope` alone), exactly as `applyCognitiveMerge` does.
 */
export async function bindApprovalSubject(params: {
  resourceId: string;
  auth: GovernanceApprovalAuth;
  requiredOwnerScope?: AgentAssetContinuityManifest["ownerScope"];
  requiredResourceType?: CatalogRecord["envelope"]["resourceType"];
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): Promise<
  { ok: true; binding: PointerOwnershipBinding } | { ok: false; deny: PointerOwnershipDenial }
> {
  const record = await readSubject({
    resourceId: params.resourceId,
    stateDir: params.stateDir,
    catalog: params.catalog,
  });
  if (!record) {
    return { ok: false, deny: "subject_not_found" };
  }
  if (params.requiredResourceType && record.envelope.resourceType !== params.requiredResourceType) {
    return { ok: false, deny: "subject_not_found" };
  }
  const tenantId = record.envelope.tenantId ?? null;
  if (tenantId !== (params.auth.callerTenantId ?? null)) {
    return { ok: false, deny: "tenant_mismatch" };
  }
  if (tenantId !== (params.auth.approvalGrant.tenantId ?? null)) {
    return { ok: false, deny: "tenant_mismatch" };
  }
  if (params.requiredOwnerScope && manifestOwnerScopeFor(record) !== params.requiredOwnerScope) {
    return { ok: false, deny: "owner_scope_mismatch" };
  }
  try {
    assertOwnershipProofMatches(record, params.auth.ownershipProof);
  } catch {
    return { ok: false, deny: "owner_not_represented" };
  }
  return { ok: true, binding: { record } };
}
