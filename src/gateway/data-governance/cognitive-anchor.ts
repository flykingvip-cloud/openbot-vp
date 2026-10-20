import { randomUUID } from "node:crypto";
import { resolveStateDir } from "../../config/paths.js";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import {
  compareAndPutAnchorPointer,
  deriveAnchorStatus,
  listHumanVerifiedAnchors,
  readAnchorMutation,
  readAnchorPointer,
  readHumanVerifiedAnchor,
  uniqueCreateHumanVerifiedAnchor,
  withAnchorOperation,
  type AnchorOperationHandle,
} from "./cognitive-anchor-store.js";
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
  AnchorActivePointer,
  AnchorDenyCode,
  DerivedAnchorStatus,
  HumanVerifiedAnchor,
  HumanVerifiedAnchorType,
  PointerMutationReceipt,
} from "./types.js";

export type ProposeAnchorParams = {
  call: GovernanceAuthenticatedCall;
  operationId: string;
  resourceId: string;
  anchorType: HumanVerifiedAnchorType;
  version: number;
  evidenceRefs: string[];
  now?: Date;
  stateDir?: string;
  /** Authoritative governed-resource registry. Defaults to the shared file Catalog. */
  catalog?: DataGovernanceCatalogStore;
};

export type ActivateAnchorParams = {
  auth: GovernanceApprovalAuth;
  operationId: string;
  resourceId: string;
  /** Proposal or existing activation/supersession row to activate. */
  anchorId?: string;
  anchorType?: HumanVerifiedAnchorType;
  version: number;
  evidenceRefs?: string[];
  expectedPointerVersion: number;
  now?: Date;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type SupersedeAnchorParams = {
  auth: GovernanceApprovalAuth;
  operationId: string;
  resourceId: string;
  supersedesAnchorId: string;
  version: number;
  evidenceRefs: string[];
  expectedPointerVersion: number;
  now?: Date;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type RevokeAnchorParams = {
  auth: GovernanceApprovalAuth;
  operationId: string;
  resourceId: string;
  /** Must name the currently active anchor. */
  anchorId: string;
  expectedPointerVersion: number;
  now?: Date;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type AnchorCommandResult =
  | {
      ok: true;
      receipt: PointerMutationReceipt;
      anchor: HumanVerifiedAnchor;
      pointer?: AnchorActivePointer;
    }
  | { ok: false; error: AnchorDenyCode; receipt?: PointerMutationReceipt };

type AnchorGrantKind = "anchor_activate" | "anchor_supersede" | "anchor_revoke";

function grantMatchesResource(
  auth: GovernanceApprovalAuth,
  resourceId: string,
  kind: AnchorGrantKind,
): boolean {
  if (auth.approvalGrant.grantKind !== kind) {
    return false;
  }
  return (
    approvalScopeFingerprint(auth.approvalGrant.scope) ===
    approvalScopeFingerprint({ kind: "resource", resourceId })
  );
}

function buildRow(params: {
  anchorId: string;
  resourceId: string;
  anchorType: HumanVerifiedAnchorType;
  version: number;
  rowKind: HumanVerifiedAnchor["rowKind"];
  evidenceRefs: string[];
  supersedesAnchorId?: string;
  approvalAudit?: HumanVerifiedAnchor["approvalAudit"];
  now: Date;
}): HumanVerifiedAnchor {
  return {
    anchorId: params.anchorId,
    kind: "human_verified_anchor",
    resourceId: params.resourceId,
    anchorType: params.anchorType,
    version: params.version,
    rowKind: params.rowKind,
    evidenceRefs: [...params.evidenceRefs],
    ...(params.supersedesAnchorId ? { supersedesAnchorId: params.supersedesAnchorId } : {}),
    ...(params.approvalAudit ? { approvalAudit: params.approvalAudit } : {}),
    effectiveAt: params.now.toISOString(),
    createdAt: params.now.toISOString(),
  };
}

/**
 * The pointer a given history row implies, derived from the row and its receipt only.
 * Prepared replay therefore reconstructs the *same* pointer target without re-reading the
 * caller's parameters, and a revocation row keeps `revokedAnchorId` (the row it revokes)
 * disjoint from `revocationRowId` (itself) per B41.
 */
function pointerForRow(params: {
  row: HumanVerifiedAnchor;
  receipt: PointerMutationReceipt;
  now: Date;
}): AnchorActivePointer | null {
  const base = {
    kind: "anchor_active_pointer" as const,
    resourceId: params.row.resourceId,
    anchorVersion: params.row.version,
    pointerVersion: params.receipt.expectedPointerVersion + 1,
    lastMutationId: params.receipt.mutationId,
    updatedAt: params.now.toISOString(),
  };
  if (params.row.rowKind === "activation" || params.row.rowKind === "supersession") {
    return { ...base, pointerState: "active", activeAnchorId: params.row.anchorId };
  }
  if (params.row.rowKind === "revocation") {
    if (!params.row.supersedesAnchorId) {
      return null;
    }
    return {
      ...base,
      pointerState: "revoked",
      revokedAnchorId: params.row.supersedesAnchorId,
      revocationRowId: params.row.anchorId,
      revokedAt: params.now.toISOString(),
      revokeMutationId: params.receipt.mutationId,
    };
  }
  return null;
}

/** Terminal replay: return the recorded outcome verbatim; never CAS, never re-approve. */
function replayTerminalAnchor(params: {
  receipt: PointerMutationReceipt;
  resourceId: string;
  stateDir: string;
}): AnchorCommandResult {
  const anchor = readHumanVerifiedAnchor({
    resourceId: params.resourceId,
    anchorId: params.receipt.historyRowId,
    stateDir: params.stateDir,
  });
  if (!anchor || anchor.resourceId !== params.resourceId) {
    return { ok: false, error: "not_found", receipt: params.receipt };
  }
  if (params.receipt.status !== "applied") {
    return {
      ok: false,
      error: params.receipt.status === "failed" ? "mutation_failed" : "mutation_conflicted",
      receipt: params.receipt,
    };
  }
  return {
    ok: true,
    receipt: params.receipt,
    anchor,
    pointer:
      readAnchorPointer({ resourceId: params.resourceId, stateDir: params.stateDir }) ?? undefined,
  };
}

/**
 * Prepared replay (§6.3). The receipt is authoritative for `mutationId`, `historyRowId` and
 * `expectedPointerVersion`; no second activation / supersession / revocation row is ever
 * created. Heal a completed pointer move, resume the original CAS, or fail closed.
 */
async function resumePreparedAnchorMutation(params: {
  op: AnchorOperationHandle;
  receipt: PointerMutationReceipt;
  resourceId: string;
  expectedPointerVersion: number;
  auth: GovernanceApprovalAuth;
  now: Date;
  stateDir: string;
}): Promise<AnchorCommandResult> {
  const receipt = params.receipt;
  const row = readHumanVerifiedAnchor({
    resourceId: params.resourceId,
    anchorId: receipt.historyRowId,
    stateDir: params.stateDir,
  });
  if (!row || row.resourceId !== params.resourceId) {
    return { ok: false, error: "not_found", receipt };
  }
  const intended = pointerForRow({ row, receipt, now: params.now });
  if (!intended) {
    return { ok: false, error: "invalid_anchor_request", receipt };
  }
  const pointer = readAnchorPointer({ resourceId: params.resourceId, stateDir: params.stateDir });
  const currentVersion = pointer?.pointerVersion ?? 0;

  const healed =
    pointer &&
    pointer.lastMutationId === receipt.mutationId &&
    pointer.pointerVersion === receipt.expectedPointerVersion + 1 &&
    pointer.pointerState === intended.pointerState &&
    (intended.pointerState === "active"
      ? pointer.activeAnchorId === intended.activeAnchorId
      : pointer.revokedAnchorId === intended.revokedAnchorId &&
        pointer.revocationRowId === intended.revocationRowId);
  if (healed && pointer) {
    const applied = params.op.putReceipt({
      ...receipt,
      status: "applied",
      resultingPointerVersion: pointer.pointerVersion,
    });
    return { ok: true, receipt: applied, anchor: row, pointer };
  }
  if (currentVersion !== receipt.expectedPointerVersion) {
    // Foreign or newer generation owns the pointer: fail closed, never overwrite it.
    const conflicted = params.op.putReceipt({ ...receipt, status: "conflicted" });
    return { ok: false, error: "version_conflict", receipt: conflicted };
  }
  if (params.expectedPointerVersion !== receipt.expectedPointerVersion) {
    return { ok: false, error: "version_conflict", receipt };
  }
  return casAnchorPointer({
    op: params.op,
    receipt,
    row,
    pointer: intended,
    auth: params.auth,
    now: params.now,
    stateDir: params.stateDir,
  });
}

/** The single pointer CAS + receipt finalize for one prepared anchor mutation. */
async function casAnchorPointer(params: {
  op: AnchorOperationHandle;
  receipt: PointerMutationReceipt;
  row: HumanVerifiedAnchor;
  pointer: AnchorActivePointer;
  auth: GovernanceApprovalAuth;
  now: Date;
  stateDir: string;
}): Promise<AnchorCommandResult> {
  const cas = await compareAndPutAnchorPointer({
    resourceId: params.row.resourceId,
    stateDir: params.stateDir,
    expectedPointerVersion: params.receipt.expectedPointerVersion,
    next: params.pointer,
  });
  if (!cas.ok) {
    const conflicted = params.op.putReceipt({ ...params.receipt, status: "conflicted" });
    return { ok: false, error: "version_conflict", receipt: conflicted };
  }
  const applied = params.op.putReceipt({
    ...params.receipt,
    status: "applied",
    resultingPointerVersion: cas.pointer.pointerVersion,
    approvalAudit: params.receipt.approvalAudit ?? approvalAuditFrom(params.auth, params.now),
  });
  return { ok: true, receipt: applied, anchor: params.row, pointer: cas.pointer };
}

/**
 * Shared activate / supersede / revoke driver.
 *
 * Order is frozen by §6.2: branded auth and ownership binding, then **terminal replay**, then
 * prepared replay, and only a genuinely new operation evaluates current-active preconditions
 * and creates an immutable row. A successful `supersedeAnchor` replay therefore never returns
 * `anchor_not_active` just because the pointer now names the supersession row.
 */
async function runAnchorPointerMutation(params: {
  resourceId: string;
  operationId: string;
  expectedPointerVersion: number;
  auth: GovernanceApprovalAuth;
  grantKind: AnchorGrantKind;
  now: Date;
  stateDir: string;
  catalog?: DataGovernanceCatalogStore;
  /** Mutable-state gate for a new operation only (idempotent short-circuit or refusal). */
  precondition?: () => AnchorCommandResult | null;
  /** Resolve/create the immutable row a new operation will point at. */
  resolveRow: () => Promise<
    { ok: true; row: HumanVerifiedAnchor } | { ok: false; error: AnchorDenyCode }
  >;
}): Promise<AnchorCommandResult> {
  if (!isGovernanceApprovalAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!grantMatchesResource(params.auth, params.resourceId, params.grantKind)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isCognitiveWriteUnlocked(params.stateDir)) {
    return { ok: false, error: "schema_write_locked" };
  }
  if (!params.operationId || !params.resourceId) {
    return { ok: false, error: "invalid_anchor_request" };
  }
  const bound = await bindApprovalSubject({
    resourceId: params.resourceId,
    auth: params.auth,
    stateDir: params.stateDir,
    catalog: params.catalog,
  });
  if (!bound.ok) {
    return {
      ok: false,
      error: bound.deny === "subject_not_found" ? "not_found" : "actor_not_authorized",
    };
  }

  return withAnchorOperation(
    { resourceId: params.resourceId, operationId: params.operationId, stateDir: params.stateDir },
    async (op): Promise<AnchorCommandResult> => {
      const indexed = op.readReceipt();
      if (indexed && indexed.status !== "prepared") {
        return replayTerminalAnchor({
          receipt: indexed,
          resourceId: params.resourceId,
          stateDir: params.stateDir,
        });
      }
      if (indexed) {
        return resumePreparedAnchorMutation({
          op,
          receipt: indexed,
          resourceId: params.resourceId,
          expectedPointerVersion: params.expectedPointerVersion,
          auth: params.auth,
          now: params.now,
          stateDir: params.stateDir,
        });
      }

      const short = params.precondition?.();
      if (short) {
        return short;
      }
      const resolved = await params.resolveRow();
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
      const created = op.createReceipt({
        mutationId: `mut-${randomUUID()}`,
        kind: "anchor_mutation",
        operationId: params.operationId,
        resourceKey: params.resourceId,
        historyRowId: resolved.row.anchorId,
        expectedPointerVersion: params.expectedPointerVersion,
        approvalAudit: approvalAuditFrom(params.auth, params.now),
        status: "prepared",
        createdAt: params.now.toISOString(),
      });
      if (!created.ok) {
        return created.existing.status === "prepared"
          ? resumePreparedAnchorMutation({
              op,
              receipt: created.existing,
              resourceId: params.resourceId,
              expectedPointerVersion: params.expectedPointerVersion,
              auth: params.auth,
              now: params.now,
              stateDir: params.stateDir,
            })
          : replayTerminalAnchor({
              receipt: created.existing,
              resourceId: params.resourceId,
              stateDir: params.stateDir,
            });
      }
      const pointer = pointerForRow({
        row: resolved.row,
        receipt: created.receipt,
        now: params.now,
      });
      if (!pointer) {
        const failed = op.putReceipt({ ...created.receipt, status: "failed" });
        return { ok: false, error: "invalid_anchor_request", receipt: failed };
      }
      return casAnchorPointer({
        op,
        receipt: created.receipt,
        row: resolved.row,
        pointer,
        auth: params.auth,
        now: params.now,
        stateDir: params.stateDir,
      });
    },
  );
}

/** Propose only — immutable proposal row bound to the governed resource; no pointer change. */
export async function proposeAnchor(params: ProposeAnchorParams): Promise<AnchorCommandResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const now = params.now ?? new Date();
  if (!isGovernanceAuthenticatedCall(params.call) || params.call.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isCognitiveWriteUnlocked(stateDir)) {
    return { ok: false, error: "schema_write_locked" };
  }
  if (!params.operationId || !params.resourceId || !params.anchorType) {
    return { ok: false, error: "invalid_anchor_request" };
  }
  // Proposal history is written under the governed resource, so the caller must be able to
  // represent that resource's owner in its own tenant partition.
  const bound = await bindUserProposalSubject({
    resourceId: params.resourceId,
    call: params.call,
    stateDir,
    catalog: params.catalog,
  });
  if (!bound.ok) {
    return {
      ok: false,
      error: bound.deny === "subject_not_found" ? "not_found" : "actor_not_authorized",
    };
  }

  return withAnchorOperation(
    { resourceId: params.resourceId, operationId: params.operationId, stateDir },
    async (op): Promise<AnchorCommandResult> => {
      const indexed = op.readReceipt();
      if (indexed) {
        const anchor = readHumanVerifiedAnchor({
          resourceId: params.resourceId,
          anchorId: indexed.historyRowId,
          stateDir,
        });
        if (!anchor) {
          return { ok: false, error: "not_found", receipt: indexed };
        }
        return indexed.status === "prepared" || indexed.status === "applied"
          ? { ok: true, receipt: indexed, anchor }
          : replayTerminalAnchor({ receipt: indexed, resourceId: params.resourceId, stateDir });
      }
      const created = await uniqueCreateHumanVerifiedAnchor({
        anchor: buildRow({
          anchorId: `anchor-${randomUUID()}`,
          resourceId: params.resourceId,
          anchorType: params.anchorType,
          version: params.version,
          rowKind: "proposal",
          evidenceRefs: params.evidenceRefs,
          now,
        }),
        stateDir,
      });
      if (!created.ok) {
        return { ok: false, error: "idempotent_mismatch" };
      }
      // Row before receipt: a prepared receipt therefore always names a row that exists,
      // and a crash between the two leaves only an invisible, never-pointed proposal row.
      const receipt = op.createReceipt({
        mutationId: `mut-${randomUUID()}`,
        kind: "anchor_mutation",
        operationId: params.operationId,
        resourceKey: params.resourceId,
        historyRowId: created.anchor.anchorId,
        expectedPointerVersion:
          readAnchorPointer({ resourceId: params.resourceId, stateDir })?.pointerVersion ?? 0,
        status: "prepared",
        createdAt: now.toISOString(),
      });
      if (!receipt.ok) {
        const anchor = readHumanVerifiedAnchor({
          resourceId: params.resourceId,
          anchorId: receipt.existing.historyRowId,
          stateDir,
        });
        if (!anchor) {
          return { ok: false, error: "not_found", receipt: receipt.existing };
        }
        return { ok: true, receipt: receipt.existing, anchor };
      }
      return { ok: true, receipt: receipt.receipt, anchor: created.anchor };
    },
  );
}

export async function activateAnchor(params: ActivateAnchorParams): Promise<AnchorCommandResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const now = params.now ?? new Date();
  return runAnchorPointerMutation({
    resourceId: params.resourceId,
    operationId: params.operationId,
    expectedPointerVersion: params.expectedPointerVersion,
    auth: params.auth,
    grantKind: "anchor_activate",
    now,
    stateDir,
    catalog: params.catalog,
    resolveRow: async () => {
      const existing = params.anchorId
        ? readHumanVerifiedAnchor({
            resourceId: params.resourceId,
            anchorId: params.anchorId,
            stateDir,
          })
        : null;
      if (params.anchorId && !existing) {
        return { ok: false, error: "not_found" };
      }
      if (existing && existing.rowKind !== "proposal") {
        // Already an activation/supersession row: point at it, never rewrite it.
        return { ok: true, row: existing };
      }
      const anchorType = existing?.anchorType ?? params.anchorType;
      if (!anchorType) {
        return { ok: false, error: "invalid_anchor_request" };
      }
      const created = await uniqueCreateHumanVerifiedAnchor({
        anchor: buildRow({
          anchorId: `anchor-${randomUUID()}`,
          resourceId: params.resourceId,
          anchorType,
          version: params.version,
          rowKind: "activation",
          evidenceRefs: params.evidenceRefs ?? existing?.evidenceRefs ?? [],
          ...(existing ? { supersedesAnchorId: existing.anchorId } : {}),
          approvalAudit: approvalAuditFrom(params.auth, now),
          now,
        }),
        stateDir,
      });
      return created.ok
        ? { ok: true, row: created.anchor }
        : { ok: false, error: "idempotent_mismatch" };
    },
  });
}

export async function supersedeAnchor(params: SupersedeAnchorParams): Promise<AnchorCommandResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const now = params.now ?? new Date();
  return runAnchorPointerMutation({
    resourceId: params.resourceId,
    operationId: params.operationId,
    expectedPointerVersion: params.expectedPointerVersion,
    auth: params.auth,
    grantKind: "anchor_supersede",
    now,
    stateDir,
    catalog: params.catalog,
    precondition: () => {
      const pointer = readAnchorPointer({ resourceId: params.resourceId, stateDir });
      if (
        !pointer ||
        pointer.pointerState !== "active" ||
        pointer.activeAnchorId !== params.supersedesAnchorId
      ) {
        return { ok: false, error: "anchor_not_active" };
      }
      return null;
    },
    resolveRow: async () => {
      const prior = readHumanVerifiedAnchor({
        resourceId: params.resourceId,
        anchorId: params.supersedesAnchorId,
        stateDir,
      });
      if (!prior) {
        return { ok: false, error: "not_found" };
      }
      const priorBytes = JSON.stringify(prior);
      const created = await uniqueCreateHumanVerifiedAnchor({
        anchor: buildRow({
          anchorId: `anchor-${randomUUID()}`,
          resourceId: params.resourceId,
          anchorType: prior.anchorType,
          version: params.version,
          rowKind: "supersession",
          evidenceRefs: params.evidenceRefs,
          supersedesAnchorId: params.supersedesAnchorId,
          approvalAudit: approvalAuditFrom(params.auth, now),
          now,
        }),
        stateDir,
      });
      if (!created.ok) {
        return { ok: false, error: "idempotent_mismatch" };
      }
      const afterPrior = JSON.stringify(
        readHumanVerifiedAnchor({
          resourceId: params.resourceId,
          anchorId: params.supersedesAnchorId,
          stateDir,
        }),
      );
      if (afterPrior !== priorBytes) {
        throw new Error("anchor_history_immutability_violated");
      }
      return { ok: true, row: created.anchor };
    },
  });
}

export async function revokeAnchor(params: RevokeAnchorParams): Promise<AnchorCommandResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const now = params.now ?? new Date();
  return runAnchorPointerMutation({
    resourceId: params.resourceId,
    operationId: params.operationId,
    expectedPointerVersion: params.expectedPointerVersion,
    auth: params.auth,
    grantKind: "anchor_revoke",
    now,
    stateDir,
    catalog: params.catalog,
    precondition: () => {
      const pointer = readAnchorPointer({ resourceId: params.resourceId, stateDir });
      // B41 repeat revoke is keyed on revokedAnchorId: return the receipt that actually did
      // it. No pointerVersion bump, no second revocation row, no fabricated receipt.
      if (
        pointer?.pointerState === "revoked" &&
        pointer.revokedAnchorId === params.anchorId &&
        pointer.revocationRowId
      ) {
        const revocation = readHumanVerifiedAnchor({
          resourceId: params.resourceId,
          anchorId: pointer.revocationRowId,
          stateDir,
        });
        const priorMutationId = pointer.revokeMutationId ?? pointer.lastMutationId;
        const priorReceipt = priorMutationId
          ? readAnchorMutation({
              resourceId: params.resourceId,
              mutationId: priorMutationId,
              stateDir,
            })
          : null;
        if (!revocation || !priorReceipt) {
          return { ok: false, error: "not_found" };
        }
        return { ok: true, receipt: priorReceipt, anchor: revocation, pointer };
      }
      if (
        !pointer ||
        pointer.pointerState !== "active" ||
        pointer.activeAnchorId !== params.anchorId
      ) {
        return { ok: false, error: "anchor_not_active" };
      }
      return null;
    },
    resolveRow: async () => {
      const active = readHumanVerifiedAnchor({
        resourceId: params.resourceId,
        anchorId: params.anchorId,
        stateDir,
      });
      if (!active) {
        return { ok: false, error: "not_found" };
      }
      const created = await uniqueCreateHumanVerifiedAnchor({
        anchor: buildRow({
          anchorId: `anchor-${randomUUID()}`,
          resourceId: params.resourceId,
          anchorType: active.anchorType,
          version: active.version,
          rowKind: "revocation",
          evidenceRefs: [],
          supersedesAnchorId: params.anchorId,
          approvalAudit: approvalAuditFrom(params.auth, now),
          now,
        }),
        stateDir,
      });
      return created.ok
        ? { ok: true, row: created.anchor }
        : { ok: false, error: "idempotent_mismatch" };
    },
  });
}

export function readActiveAnchor(params: {
  resourceId: string;
  stateDir: string;
}): HumanVerifiedAnchor | null {
  const pointer = readAnchorPointer(params);
  if (!pointer || pointer.pointerState !== "active" || !pointer.activeAnchorId) {
    return null;
  }
  return readHumanVerifiedAnchor({
    resourceId: params.resourceId,
    anchorId: pointer.activeAnchorId,
    stateDir: params.stateDir,
  });
}

export function readDerivedAnchorStatus(params: {
  resourceId: string;
  anchorId: string;
  stateDir: string;
}): DerivedAnchorStatus | null {
  const row = readHumanVerifiedAnchor(params);
  if (!row) {
    return null;
  }
  return deriveAnchorStatus({
    row,
    pointer: readAnchorPointer(params),
    allRows: listHumanVerifiedAnchors(params),
  });
}

export {
  readAnchorPointer,
  readHumanVerifiedAnchor,
  resourceHasActiveAnchor,
} from "./cognitive-anchor-store.js";
