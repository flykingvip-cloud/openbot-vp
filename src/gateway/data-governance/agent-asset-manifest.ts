import { randomUUID } from "node:crypto";
import { resolveStateDir } from "../../config/paths.js";
import {
  compareAndPutManifestPointer,
  computeManifestContentKey,
  findManifestByContentKey,
  hashManifestReferencedVersions,
  readAgentAssetManifest,
  readAgentAssetManifestPointer,
  readManifestMutationByOperation,
  rejectEmbeddedManifestPayload,
  uniqueCreateAgentAssetManifest,
  withManifestOperation,
  type ManifestOperationHandle,
} from "./agent-asset-manifest-store.js";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import {
  approvalAuditFrom,
  isGovernanceApprovalAuth,
  type GovernanceApprovalAuth,
} from "./cognitive-approval-auth.js";
import { approvalScopeFingerprint } from "./cognitive-approval-grant-store.js";
import { bindApprovalSubject, bindUserProposalSubject } from "./cognitive-pointer-ownership.js";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { isCognitiveWriteUnlocked } from "./cognitive-write-unlock.js";
import type {
  AgentAssetContinuityManifest,
  AgentAssetManifestPointer,
  ManifestDenyCode,
  PointerMutationReceipt,
} from "./types.js";

export type ProposeManifestSupersessionParams = {
  call: GovernanceAuthenticatedCall;
  operationId: string;
  agentAssetId: string;
  ownerScope: AgentAssetContinuityManifest["ownerScope"];
  personaVersionRef?: string;
  identityVersionRef: string;
  capabilitySetVersionRef: string;
  workingDnaVersionRef?: string;
  policyBaselineRef: string;
  experienceCheckpointRef?: string;
  operationalIdentityBindingRefs: string[];
  reasonCode: string;
  previousManifestId?: string;
  expectedPointerVersion: number;
  now?: Date;
  stateDir?: string;
  /** Authoritative AgentAsset registry. Defaults to the shared file Catalog. */
  catalog?: DataGovernanceCatalogStore;
};

export type ApproveManifestSupersessionParams = {
  auth: GovernanceApprovalAuth;
  agentAssetId: string;
  /** Continue a prepared propose, or replay an applied/conflicted outcome. */
  operationId: string;
  /** When activating an orphan without a prior propose of this content. */
  manifestId?: string;
  expectedPointerVersion: number;
  now?: Date;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type ManifestCommandResult =
  | {
      ok: true;
      receipt: PointerMutationReceipt;
      manifest: AgentAssetContinuityManifest;
      pointer?: AgentAssetManifestPointer;
    }
  | { ok: false; error: ManifestDenyCode; receipt?: PointerMutationReceipt };

/** The AgentAsset is a governed `agent` Catalog row; manifests never invent their own subject. */
const AGENT_ASSET_RESOURCE_TYPE = "agent" as const;

function grantMatchesAgentAsset(auth: GovernanceApprovalAuth, agentAssetId: string): boolean {
  return (
    approvalScopeFingerprint(auth.approvalGrant.scope) ===
    approvalScopeFingerprint({ kind: "agentAsset", agentAssetId })
  );
}

function buildManifestRow(params: {
  manifestId: string;
  agentAssetId: string;
  ownerScope: AgentAssetContinuityManifest["ownerScope"];
  personaVersionRef?: string;
  identityVersionRef: string;
  capabilitySetVersionRef: string;
  workingDnaVersionRef?: string;
  policyBaselineRef: string;
  experienceCheckpointRef?: string;
  operationalIdentityBindingRefs: string[];
  previousManifestId?: string;
  reasonCode: string;
  contentKey: string;
  now: Date;
}): AgentAssetContinuityManifest {
  return {
    manifestId: params.manifestId,
    kind: "agent_asset_continuity_manifest",
    agentAssetId: params.agentAssetId,
    ownerScope: params.ownerScope,
    ...(params.personaVersionRef ? { personaVersionRef: params.personaVersionRef } : {}),
    identityVersionRef: params.identityVersionRef,
    capabilitySetVersionRef: params.capabilitySetVersionRef,
    ...(params.workingDnaVersionRef ? { workingDnaVersionRef: params.workingDnaVersionRef } : {}),
    policyBaselineRef: params.policyBaselineRef,
    ...(params.experienceCheckpointRef
      ? { experienceCheckpointRef: params.experienceCheckpointRef }
      : {}),
    operationalIdentityBindingRefs: [...params.operationalIdentityBindingRefs],
    ...(params.previousManifestId ? { previousManifestId: params.previousManifestId } : {}),
    contentKey: params.contentKey,
    reasonCode: params.reasonCode,
    effectiveAt: params.now.toISOString(),
    createdAt: params.now.toISOString(),
  };
}

/** Replay of a receipt that already reached a terminal state — never re-CAS, never re-approve. */
function replayTerminal(params: {
  receipt: PointerMutationReceipt;
  agentAssetId: string;
  stateDir: string;
}): ManifestCommandResult {
  const manifest = readAgentAssetManifest({
    agentAssetId: params.agentAssetId,
    manifestId: params.receipt.historyRowId,
    stateDir: params.stateDir,
  });
  if (!manifest || manifest.agentAssetId !== params.agentAssetId) {
    return { ok: false, error: "not_found", receipt: params.receipt };
  }
  if (params.receipt.status !== "applied") {
    return {
      ok: false,
      error: params.receipt.status === "failed" ? "mutation_failed" : "mutation_conflicted",
      receipt: params.receipt,
    };
  }
  const pointer = readAgentAssetManifestPointer({
    agentAssetId: params.agentAssetId,
    stateDir: params.stateDir,
  });
  return { ok: true, receipt: params.receipt, manifest, pointer: pointer ?? undefined };
}

/**
 * User-authenticated propose: binds the AgentAsset, writes the immutable history row (or
 * reuses the content-identical one), then the prepared receipt. Never CASes the pointer (B11).
 *
 * The history row is resolved **before** the receipt so a prepared receipt always names a row
 * that exists, and `historyRowId` is never rewritten afterwards.
 */
export async function proposeManifestSupersession(
  params: ProposeManifestSupersessionParams,
): Promise<ManifestCommandResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const now = params.now ?? new Date();
  if (!isGovernanceAuthenticatedCall(params.call)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (params.call.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isCognitiveWriteUnlocked(stateDir)) {
    return { ok: false, error: "schema_write_locked" };
  }
  if (!params.operationId || !params.agentAssetId || !params.reasonCode) {
    return { ok: false, error: "invalid_manifest_request" };
  }
  if (!params.identityVersionRef || !params.capabilitySetVersionRef || !params.policyBaselineRef) {
    return { ok: false, error: "invalid_manifest_request" };
  }
  const embedded = rejectEmbeddedManifestPayload(params as unknown as Record<string, unknown>);
  if (embedded) {
    return { ok: false, error: "embedded_payload_forbidden" };
  }
  // Authority to write proposal history comes from the AgentAsset owner scope, not from
  // being authenticated: an unknown, foreign-tenant or unrepresented asset stops here,
  // before any filesystem write.
  const bound = await bindUserProposalSubject({
    resourceId: params.agentAssetId,
    call: params.call,
    requiredOwnerScope: params.ownerScope,
    requiredResourceType: AGENT_ASSET_RESOURCE_TYPE,
    stateDir,
    catalog: params.catalog,
  });
  if (!bound.ok) {
    return {
      ok: false,
      error: bound.deny === "subject_not_found" ? "not_found" : "actor_not_authorized",
    };
  }

  const versionHash = hashManifestReferencedVersions({
    personaVersionRef: params.personaVersionRef,
    identityVersionRef: params.identityVersionRef,
    capabilitySetVersionRef: params.capabilitySetVersionRef,
    workingDnaVersionRef: params.workingDnaVersionRef,
    policyBaselineRef: params.policyBaselineRef,
    experienceCheckpointRef: params.experienceCheckpointRef,
    operationalIdentityBindingRefs: params.operationalIdentityBindingRefs,
  });
  const contentKey = computeManifestContentKey({
    agentAssetId: params.agentAssetId,
    referencedVersionSetHash: versionHash,
    reasonCode: params.reasonCode,
  });

  return withManifestOperation(
    { agentAssetId: params.agentAssetId, operationId: params.operationId, stateDir },
    async (op): Promise<ManifestCommandResult> => {
      const indexed = op.readReceipt();
      if (indexed) {
        if (indexed.status !== "prepared") {
          return replayTerminal({ receipt: indexed, agentAssetId: params.agentAssetId, stateDir });
        }
        const manifest = readAgentAssetManifest({
          agentAssetId: params.agentAssetId,
          manifestId: indexed.historyRowId,
          stateDir,
        });
        if (!manifest) {
          return { ok: false, error: "not_found", receipt: indexed };
        }
        return { ok: true, receipt: indexed, manifest };
      }

      const reused = findManifestByContentKey({
        agentAssetId: params.agentAssetId,
        contentKey,
        stateDir,
      });
      const manifestId = reused?.manifestId ?? `manifest-${randomUUID()}`;
      const history = await uniqueCreateAgentAssetManifest({
        manifest: buildManifestRow({
          manifestId,
          agentAssetId: params.agentAssetId,
          ownerScope: params.ownerScope,
          personaVersionRef: params.personaVersionRef,
          identityVersionRef: params.identityVersionRef,
          capabilitySetVersionRef: params.capabilitySetVersionRef,
          workingDnaVersionRef: params.workingDnaVersionRef,
          policyBaselineRef: params.policyBaselineRef,
          experienceCheckpointRef: params.experienceCheckpointRef,
          operationalIdentityBindingRefs: params.operationalIdentityBindingRefs,
          previousManifestId: params.previousManifestId,
          reasonCode: params.reasonCode,
          contentKey,
          now,
        }),
        stateDir,
      });
      if (!history.ok) {
        return { ok: false, error: "idempotent_mismatch" };
      }
      const created = op.createReceipt({
        mutationId: `mut-${randomUUID()}`,
        kind: "agent_asset_manifest_mutation",
        operationId: params.operationId,
        resourceKey: params.agentAssetId,
        historyRowId: history.manifest.manifestId,
        expectedPointerVersion: params.expectedPointerVersion,
        status: "prepared",
        createdAt: now.toISOString(),
      });
      if (!created.ok) {
        const manifest = readAgentAssetManifest({
          agentAssetId: params.agentAssetId,
          manifestId: created.existing.historyRowId,
          stateDir,
        });
        if (!manifest) {
          return { ok: false, error: "not_found", receipt: created.existing };
        }
        return { ok: true, receipt: created.existing, manifest };
      }
      return { ok: true, receipt: created.receipt, manifest: history.manifest };
    },
  );
}

/**
 * Approve / activate: requires the branded `manifest_supersede` grant bound to the actual
 * AgentAsset row. A new operationId may activate an already-written orphan (B31); a replay
 * of a terminal operation returns its recorded outcome verbatim, and a replay of a prepared
 * operation converges on the pointer move that operation already started.
 */
export async function approveManifestSupersession(
  params: ApproveManifestSupersessionParams,
): Promise<ManifestCommandResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const now = params.now ?? new Date();
  if (!isGovernanceApprovalAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (params.auth.approvalGrant.grantKind !== "manifest_supersede") {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!grantMatchesAgentAsset(params.auth, params.agentAssetId)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isCognitiveWriteUnlocked(stateDir)) {
    return { ok: false, error: "schema_write_locked" };
  }
  if (!params.operationId || !params.agentAssetId) {
    return { ok: false, error: "invalid_manifest_request" };
  }
  const bound = await bindApprovalSubject({
    resourceId: params.agentAssetId,
    auth: params.auth,
    requiredResourceType: AGENT_ASSET_RESOURCE_TYPE,
    stateDir,
    catalog: params.catalog,
  });
  if (!bound.ok) {
    return {
      ok: false,
      error: bound.deny === "subject_not_found" ? "not_found" : "actor_not_authorized",
    };
  }

  return withManifestOperation(
    { agentAssetId: params.agentAssetId, operationId: params.operationId, stateDir },
    async (op): Promise<ManifestCommandResult> => {
      const indexed = op.readReceipt();
      if (indexed && indexed.status !== "prepared") {
        return replayTerminal({ receipt: indexed, agentAssetId: params.agentAssetId, stateDir });
      }
      if (indexed) {
        return resumePreparedManifestMutation({
          op,
          receipt: indexed,
          agentAssetId: params.agentAssetId,
          expectedPointerVersion: params.expectedPointerVersion,
          auth: params.auth,
          now,
          stateDir,
        });
      }

      // First run of this operation: activation of a proposed or orphaned manifest row.
      const manifestId = params.manifestId;
      if (!manifestId) {
        return { ok: false, error: "invalid_manifest_request" };
      }
      const manifest = readAgentAssetManifest({
        agentAssetId: params.agentAssetId,
        manifestId,
        stateDir,
      });
      if (!manifest || manifest.agentAssetId !== params.agentAssetId) {
        return { ok: false, error: "not_found" };
      }
      const created = op.createReceipt({
        mutationId: `mut-${randomUUID()}`,
        kind: "agent_asset_manifest_mutation",
        operationId: params.operationId,
        resourceKey: params.agentAssetId,
        historyRowId: manifest.manifestId,
        expectedPointerVersion: params.expectedPointerVersion,
        approvalAudit: approvalAuditFrom(params.auth, now),
        status: "prepared",
        createdAt: now.toISOString(),
      });
      if (!created.ok) {
        return created.existing.status === "prepared"
          ? resumePreparedManifestMutation({
              op,
              receipt: created.existing,
              agentAssetId: params.agentAssetId,
              expectedPointerVersion: params.expectedPointerVersion,
              auth: params.auth,
              now,
              stateDir,
            })
          : replayTerminal({
              receipt: created.existing,
              agentAssetId: params.agentAssetId,
              stateDir,
            });
      }
      return casManifestPointer({
        op,
        receipt: created.receipt,
        manifest,
        agentAssetId: params.agentAssetId,
        auth: params.auth,
        now,
        stateDir,
      });
    },
  );
}

/**
 * Prepared receipt replay (§5.2 crash window). The receipt is authoritative for
 * `historyRowId` and `expectedPointerVersion`; neither is ever rewritten here.
 *
 * - pointer already proves this mutation moved it → heal to `applied` (no second CAS);
 * - pointer still at the receipt's expected version → resume that one CAS;
 * - anything else (newer pointer, foreign identity) → fail closed, pointer untouched.
 */
async function resumePreparedManifestMutation(params: {
  op: ManifestOperationHandle;
  receipt: PointerMutationReceipt;
  agentAssetId: string;
  expectedPointerVersion: number;
  auth: GovernanceApprovalAuth;
  now: Date;
  stateDir: string;
}): Promise<ManifestCommandResult> {
  const receipt = params.receipt;
  const manifest = readAgentAssetManifest({
    agentAssetId: params.agentAssetId,
    manifestId: receipt.historyRowId,
    stateDir: params.stateDir,
  });
  if (!manifest || manifest.agentAssetId !== params.agentAssetId) {
    return { ok: false, error: "not_found", receipt };
  }
  const pointer = readAgentAssetManifestPointer({
    agentAssetId: params.agentAssetId,
    stateDir: params.stateDir,
  });
  const currentVersion = pointer?.pointerVersion ?? 0;

  if (
    pointer &&
    pointer.lastMutationId === receipt.mutationId &&
    pointer.pointerVersion === receipt.expectedPointerVersion + 1 &&
    pointer.activeManifestId === receipt.historyRowId
  ) {
    const healed = params.op.putReceipt({
      ...receipt,
      status: "applied",
      resultingPointerVersion: pointer.pointerVersion,
    });
    return { ok: true, receipt: healed, manifest, pointer };
  }
  if (currentVersion !== receipt.expectedPointerVersion) {
    // Someone else owns the current generation. Never overwrite a foreign/newer pointer.
    const conflicted = params.op.putReceipt({ ...receipt, status: "conflicted" });
    return { ok: false, error: "version_conflict", receipt: conflicted };
  }
  if (params.expectedPointerVersion !== receipt.expectedPointerVersion) {
    // The caller is asking for a different generation than the prepared operation recorded.
    // Refuse without mutating the receipt so the original operation stays resumable.
    return { ok: false, error: "version_conflict", receipt };
  }
  return casManifestPointer({
    op: params.op,
    receipt,
    manifest,
    agentAssetId: params.agentAssetId,
    auth: params.auth,
    now: params.now,
    stateDir: params.stateDir,
  });
}

/** The single pointer CAS + receipt finalize for one prepared mutation. */
async function casManifestPointer(params: {
  op: ManifestOperationHandle;
  receipt: PointerMutationReceipt;
  manifest: AgentAssetContinuityManifest;
  agentAssetId: string;
  auth: GovernanceApprovalAuth;
  now: Date;
  stateDir: string;
}): Promise<ManifestCommandResult> {
  const receipt = params.receipt;
  const cas = await compareAndPutManifestPointer({
    agentAssetId: params.agentAssetId,
    stateDir: params.stateDir,
    expectedPointerVersion: receipt.expectedPointerVersion,
    next: {
      kind: "agent_asset_manifest_pointer",
      agentAssetId: params.agentAssetId,
      activeManifestId: receipt.historyRowId,
      pointerVersion: receipt.expectedPointerVersion + 1,
      lastMutationId: receipt.mutationId,
      updatedAt: params.now.toISOString(),
    },
  });
  if (!cas.ok) {
    const conflicted = params.op.putReceipt({ ...receipt, status: "conflicted" });
    return { ok: false, error: "version_conflict", receipt: conflicted };
  }
  const applied = params.op.putReceipt({
    ...receipt,
    status: "applied",
    resultingPointerVersion: cas.pointer.pointerVersion,
    approvalAudit: receipt.approvalAudit ?? approvalAuditFrom(params.auth, params.now),
  });
  return { ok: true, receipt: applied, manifest: params.manifest, pointer: cas.pointer };
}

export {
  readAgentAssetManifest,
  readAgentAssetManifestPointer,
  readManifestMutationByOperation,
} from "./agent-asset-manifest-store.js";
