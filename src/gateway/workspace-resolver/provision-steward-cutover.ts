import { sanitizeEmployeeStewardIdentity } from "../../agents/builtin-steward/employee-isolation.js";
import type { TenantContext } from "../tenant-context.js";
import {
  advanceCutoverOperation,
  assertSingleWritableCanonicalBinding,
  createWorkspaceCutoverOperation,
  findActiveCutoverOperation,
  InMemoryWorkspaceCutoverStore,
  transitionWorkspaceCutoverOperation,
  type WorkspaceCutoverOperation,
  type WorkspaceCutoverStore,
} from "../workspace-cutover/index.js";
import type { OwnershipProof, WorkspaceOwnerScope } from "../workspace-ownership/types.js";
import { buildEmployeeStewardCutoverCatalogEntries, buildWorkspaceResourceId } from "./builders.js";
import { InMemoryWorkspaceResourceCatalog, type WorkspaceResourceCatalog } from "./catalog.js";
import { resolveWorkspaceActorTenantId } from "./group-read.js";
import { materializeStewardCutover } from "./steward-materialize.js";
import {
  resolveStewardPlacement,
  type StewardPlacementHandle,
} from "./steward-placement-policy.js";
import { STEWARD_BUILTIN_AGENT_ASSET_ID } from "./steward-write.js";
import type { WorkspaceBindingRecord } from "./types.js";

/**
 * Controlled provisioning command for the A_employee steward workspace cutover.
 *
 * This is the narrow domain command recommended by the Batch 23 / S26 Semantic Gate CR
 * (docs/design/evidence/memory-workspace-phase1b-item7-batch23-s26-semantic-gate.json). It exists
 * to establish the source/target Catalog bindings BEFORE any filesystem work, so that a future
 * retirement of the S26/S27 pilot call sites can read an already-existing binding instead of
 * building one from host roots inline.
 *
 * Scope guardrails (do not remove without governance approval):
 *  - It does NOT persist to a production Catalog SoT. It returns an in-memory {@link WorkspaceResourceCatalog}
 *    and, unless a store is supplied, records the fencing operation in an in-memory store only.
 *  - It does NOT retire S26/S27 and does NOT modify `runEmployeeStewardCutoverPilot`.
 *  - Filesystem writes (mkdir/copy) happen ONLY after the Catalog bindings + receipt + fencing
 *    operation are established, and only when `materialize` is true.
 */

export type StewardCutoverProvisionActor = {
  /** Server-trusted authenticated user id (never a wire-supplied value). */
  userId: string;
};

export type StewardCutoverProvisionRequest = {
  /** Server-trusted tenant context (from resolveTenantContext); never wire-supplied. */
  tenantContext: TenantContext | null;
  /** Server-trusted authenticated actor. */
  actor: StewardCutoverProvisionActor | null;
  /** Explicit ownership proof binding the actor to the steward asset. */
  ownershipProof: OwnershipProof | null;
  /**
   * Trusted placement supplied by the caller (deterministic workspace roots). The command does NOT
   * derive these from the host-path resolvers, so it adds no new Phase 0 watched call sites and
   * performs no implicit host fallback. `placementRoot` is the allowed base root that source/target
   * must resolve within (realpath containment; symlink escape and arbitrary paths are rejected);
   * production callers must pass a tenant/user-scoped root. Fails closed if any is empty or the
   * placement policy is violated.
   */
  placementRoot: string;
  sourceRoot: string;
  targetRoot: string;
  /** Fencing store; defaults to an in-memory store (no production persistence). */
  cutoverStore?: WorkspaceCutoverStore;
  /** Deterministic operation id; defaults to steward-cutover:<tenant>:<user>:<asset>. */
  operationId?: string;
  nowMs?: number;
  /** When true, perform the gated mkdir/copy after Catalog success. Default false (dry provision). */
  materialize?: boolean;
};

export type StewardCutoverProvisionReceipt = {
  resourceId: string;
  sourceBindingId: string;
  targetBindingId: string;
  contentVersion: string;
  governanceVersion: number;
  catalogStatus: "available" | "unavailable";
  operationId: string;
  operationState: WorkspaceCutoverOperation["state"];
  sourceRoot: string;
  targetRoot: string;
  /** Auditable placement decision (identity + logical/real roots) from the placement policy. */
  placement: StewardPlacementHandle;
  materialized: boolean;
  copyDigest: string | null;
  /** Operation-scoped staging root used for the atomic publish (null before materialize). */
  stagingRoot: string | null;
  /** Residual/quarantine path when a partial artifact was moved aside on failure (null otherwise). */
  quarantinePath: string | null;
  provisionedAtMs: number;
};

export type StewardCutoverProvisionFailureReason =
  | "missing_tenant_context"
  | "missing_actor"
  | "missing_ownership_proof"
  | "missing_placement"
  | "placement_missing"
  | "placement_root_not_absolute"
  | "placement_not_absolute"
  | "placement_path_escape"
  | "placement_root_missing"
  | "placement_outside_allowed_root"
  | "placement_symlink_escape"
  | "placement_source_target_collision"
  | "actor_owner_mismatch"
  | "ownership_proof_mismatch"
  | "tenant_id_required"
  | "user_id_required"
  | "agent_asset_id_required"
  | "catalog_record_required"
  | "tenant_mismatch"
  | "dual_writable_canonical"
  | "source_binding_not_unique"
  | "target_binding_not_unique"
  | "concurrent_operation"
  | "mkdir_source_failed"
  | "target_exists"
  | "copy_failed"
  | "digest_mismatch"
  | "publish_failed"
  | "post_publish_digest_mismatch"
  | "verified_copy_failed";

export type StewardCutoverProvisionSuccess = {
  ok: true;
  resourceId: string;
  sourceBindingId: string;
  targetBindingId: string;
  catalog: WorkspaceResourceCatalog;
  operation: WorkspaceCutoverOperation;
  receipt: StewardCutoverProvisionReceipt;
  sourceRoot: string;
  targetRoot: string;
};

export type StewardCutoverProvisionFailure = {
  ok: false;
  reason: StewardCutoverProvisionFailureReason;
  /** Every failure halts the provision and requires operator recovery; no partial fs state is left behind before Catalog success. */
  recovery: "recovery_required";
  halted: true;
  detail?: string;
  /** When a partial artifact was quarantined during materialization, its residual path (else null/absent). */
  residualPath?: string | null;
};

export type StewardCutoverProvisionResult =
  | StewardCutoverProvisionSuccess
  | StewardCutoverProvisionFailure;

function halt(
  reason: StewardCutoverProvisionFailureReason,
  detail?: string,
  residualPath?: string | null,
): StewardCutoverProvisionFailure {
  return {
    ok: false,
    reason,
    recovery: "recovery_required",
    halted: true,
    ...(detail ? { detail } : {}),
    ...(residualPath !== undefined ? { residualPath } : {}),
  };
}

function mapBuildError(err: unknown): StewardCutoverProvisionFailureReason {
  const message = err instanceof Error ? err.message : String(err);
  switch (message) {
    case "tenant_id_required":
    case "user_id_required":
    case "agent_asset_id_required":
    case "catalog_record_required":
    case "tenant_mismatch":
      return message;
    default:
      return "catalog_record_required";
  }
}

/**
 * Provision the steward cutover source/target Catalog bindings (Catalog-first, fail-closed).
 * Returns a fencing operation + receipt; performs no filesystem work unless `materialize` is true.
 */
export function provisionEmployeeStewardCutoverWorkspace(
  request: StewardCutoverProvisionRequest,
): StewardCutoverProvisionResult {
  // (1) Server-trusted inputs — fail-closed on anything missing or inconsistent.
  const tenantContext = request.tenantContext;
  if (
    !tenantContext ||
    !tenantContext.tenantId?.trim() ||
    !tenantContext.userId?.trim() ||
    tenantContext.domain !== "enterprise"
  ) {
    return halt("missing_tenant_context");
  }
  if (!request.actor || !request.actor.userId?.trim()) {
    return halt("missing_actor");
  }
  const proof = request.ownershipProof;
  if (
    !proof ||
    proof.source !== "explicit_binding" ||
    proof.ownerType !== "user" ||
    !proof.ownerId?.trim() ||
    !proof.agentAssetId?.trim()
  ) {
    return halt("missing_ownership_proof");
  }

  const tenantId = resolveWorkspaceActorTenantId(tenantContext.tenantId);
  const userId = sanitizeEmployeeStewardIdentity(tenantContext.userId);
  const agentAssetId = STEWARD_BUILTIN_AGENT_ASSET_ID;

  // Actor and proof must resolve to the same trusted subject/asset (no impersonation, no host fallback).
  if (sanitizeEmployeeStewardIdentity(request.actor.userId) !== userId) {
    return halt("actor_owner_mismatch");
  }
  if (
    sanitizeEmployeeStewardIdentity(proof.ownerId) !== userId ||
    proof.agentAssetId !== agentAssetId
  ) {
    return halt("ownership_proof_mismatch");
  }

  // (2) Stable resourceId derived from the trusted scope.
  const scope: WorkspaceOwnerScope = {
    kind: "user_owned",
    userId,
    agentAssetId,
    proof: { source: "explicit_binding", ownerType: "user", ownerId: userId, agentAssetId },
  };
  const resourceId = buildWorkspaceResourceId({ tenantId, scope });

  // (3) Placement policy — physically validate the caller-supplied roots: absolute, no `..`, realpath
  // containment inside the allowed root, symlink-escape rejected, distinct by realpath; bound to this
  // tenant/user/resource. The command never derives roots from host-path resolvers (freeze-safe).
  if (
    !request.placementRoot?.trim() ||
    !request.sourceRoot?.trim() ||
    !request.targetRoot?.trim()
  ) {
    return halt("missing_placement");
  }
  const placement = resolveStewardPlacement(
    {
      tenantId,
      userId,
      resourceId,
      allowedRoot: request.placementRoot,
      sourceRoot: request.sourceRoot,
      targetRoot: request.targetRoot,
    },
    request.nowMs,
  );
  if (!placement.ok) {
    return halt(placement.reason);
  }
  const sourceRoot = placement.handle.sourceRoot;
  const targetRoot = placement.handle.targetRoot;

  // (4/5) Build the unique source canonical/active and target compatibility/read_only bindings.
  let entries: ReturnType<typeof buildEmployeeStewardCutoverCatalogEntries>;
  try {
    entries = buildEmployeeStewardCutoverCatalogEntries({
      tenantId,
      userId,
      sourceRoot,
      targetRoot,
      agentAssetId,
    });
  } catch (err) {
    return halt(mapBuildError(err), err instanceof Error ? err.message : undefined);
  }
  if (entries.resource.resourceId !== resourceId) {
    return halt("tenant_mismatch", "derived resourceId does not match catalog resource");
  }
  const sourceBinding = entries.sourceBinding; // role=canonical, state=active
  const targetBinding = entries.targetBinding; // role=compatibility, state=read_only
  const bindings: WorkspaceBindingRecord[] = [sourceBinding, targetBinding];

  // (4) Exactly one writable canonical binding (the source) — reject dual writers.
  const canonicalGuard = assertSingleWritableCanonicalBinding(bindings, resourceId);
  if (!canonicalGuard.ok) {
    return halt("dual_writable_canonical");
  }
  if (canonicalGuard.bindingId !== sourceBinding.bindingId) {
    return halt("source_binding_not_unique");
  }
  // (5) Exactly one compatibility/read_only target binding.
  const targets = bindings.filter(
    (binding) =>
      binding.resourceId === resourceId &&
      binding.role === "compatibility" &&
      binding.state === "read_only",
  );
  if (targets.length !== 1 || targets[0]?.bindingId !== targetBinding.bindingId) {
    return halt("target_binding_not_unique");
  }

  // Assemble the Catalog (in-memory SoT for this provision; no production Catalog write).
  const catalog = new InMemoryWorkspaceResourceCatalog({
    governanceVersion: entries.resource.governanceVersion,
    status: "available",
    resources: { [entries.resource.resourceId]: entries.resource },
    bindings: {
      [sourceBinding.bindingId]: sourceBinding,
      [targetBinding.bindingId]: targetBinding,
    },
  });

  // (7) Fencing marker: create the cutover operation and record it in the store.
  const nowMs = request.nowMs ?? Date.now();
  const operationId =
    request.operationId ?? `steward-cutover:${tenantId}:${userId}:${agentAssetId}`;
  const store = request.cutoverStore ?? new InMemoryWorkspaceCutoverStore();
  // (7a) Fencing: exactly one active operation per resource. Reject a different non-terminal
  // operation on this resource (a same-id call is an idempotent resume and is allowed to proceed).
  const activeOnResource = findActiveCutoverOperation(store.listByResource(resourceId), resourceId);
  if (activeOnResource && activeOnResource.operationId !== operationId) {
    return halt(
      "concurrent_operation",
      `active operation ${activeOnResource.operationId} in state ${activeOnResource.state}`,
    );
  }
  let operation = createWorkspaceCutoverOperation({
    operationId,
    resourceId,
    sourceBindingId: sourceBinding.bindingId,
    targetBindingId: targetBinding.bindingId,
    expectedContentVersion: sourceBinding.contentVersion,
    nowMs,
  });
  store.save(operation);

  // (6) Catalog receipt.
  const receipt: StewardCutoverProvisionReceipt = {
    resourceId,
    sourceBindingId: sourceBinding.bindingId,
    targetBindingId: targetBinding.bindingId,
    contentVersion: sourceBinding.contentVersion,
    governanceVersion: entries.resource.governanceVersion,
    catalogStatus: "available",
    operationId,
    operationState: operation.state,
    sourceRoot,
    targetRoot,
    placement: placement.handle,
    materialized: false,
    copyDigest: null,
    stagingRoot: null,
    quarantinePath: null,
    provisionedAtMs: nowMs,
  };

  // (8) Filesystem work only AFTER Catalog success + fencing, and only when explicitly requested.
  // (9) Materialization is all-or-nothing: copy to an operation-scoped staging root, hash-verify,
  // atomically publish (rename), re-verify, and quarantine any partial artifact on failure — a
  // partial/incorrect target is never exposed as a normal binding.
  // (10) No catalog-less directory: this is unreachable until every step above succeeded.
  if (request.materialize) {
    const opToken = operationId.replace(/[^A-Za-z0-9_.-]/g, "_");
    const stagingRoot = `${targetRoot}.staging-${opToken}`;
    const quarantineRoot = `${targetRoot}.quarantine-${opToken}-${nowMs}`;
    const materialized = materializeStewardCutover({
      sourceRoot,
      targetRoot,
      stagingRoot,
      quarantineRoot,
    });
    if (!materialized.ok) {
      // Any failure halts and requires recovery; the operation is marked failed to preserve fencing,
      // and the residual (quarantined) path is recorded on the receipt + failure result.
      receipt.quarantinePath = materialized.residualPath;
      return failOperation(
        store,
        operation,
        nowMs,
        materialized.reason,
        materialized.reason,
        materialized.residualPath,
      );
    }
    operation = transitionWorkspaceCutoverOperation({ operation, nextState: "prepared", nowMs });
    store.save(operation);
    receipt.materialized = true;
    receipt.copyDigest = materialized.digest;
    receipt.stagingRoot = materialized.stagingRoot;
    receipt.operationState = operation.state;
  }

  return {
    ok: true,
    resourceId,
    sourceBindingId: sourceBinding.bindingId,
    targetBindingId: targetBinding.bindingId,
    catalog,
    operation,
    receipt,
    sourceRoot,
    targetRoot,
  };
}

function failOperation(
  store: WorkspaceCutoverStore,
  operation: WorkspaceCutoverOperation,
  nowMs: number,
  reason: StewardCutoverProvisionFailureReason,
  detail: string,
  residualPath?: string | null,
): StewardCutoverProvisionFailure {
  try {
    const failed = transitionWorkspaceCutoverOperation({
      operation,
      nextState: "failed",
      nowMs,
      lastError: detail,
    });
    store.save(failed);
  } catch {
    // Best-effort fencing update; the halt result below is authoritative.
  }
  return halt(reason, detail, residualPath);
}

/**
 * @internal TEST-ONLY. NOT re-exported from the package barrel (workspace-resolver/index.ts); production
 * code MUST NOT import, re-export, or call this helper. This is enforced by the machine gate
 * pilot-test-only-boundary.test.ts (a doc tag alone is not the gate). The Batch 24 S26/S27 retirement
 * rests on this pilot being test-only; a production caller would undermine that premise.
 *
 * Local pilot: create + advance one A_employee cutover to resolver_write_cutover via the controlled
 * provisioning command. Intended for controlled OPENBOT_STATE_DIR / temp fixtures — not production live.
 *
 * Batch 24 (S26/S27 retirement): placement (sourceRoot/targetRoot) is a trusted caller-supplied input;
 * the pilot no longer calls the host-path resolvers. It provisions the source canonical/active and target
 * compatibility/read_only bindings via provisionEmployeeStewardCutoverWorkspace, then reads the roots from
 * those bindings (S26 = source canonical binding; S27 = target compatibility/read_only binding).
 */
export function runEmployeeStewardCutoverPilot(params: {
  tenantId: string;
  userId: string;
  cutoverStore: WorkspaceCutoverStore;
  placementRoot: string;
  sourceRoot: string;
  targetRoot: string;
  operationId?: string;
  nowMs?: number;
}): {
  operation: WorkspaceCutoverOperation;
  sourceRoot: string;
  targetRoot: string;
  resourceId: string;
  sourceBindingId: string;
  targetBindingId: string;
} {
  const userId = sanitizeEmployeeStewardIdentity(params.userId);
  const provision = provisionEmployeeStewardCutoverWorkspace({
    tenantContext: {
      tenantId: resolveWorkspaceActorTenantId(params.tenantId),
      userId,
      domain: "enterprise",
    },
    actor: { userId },
    ownershipProof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: userId,
      agentAssetId: STEWARD_BUILTIN_AGENT_ASSET_ID,
    },
    placementRoot: params.placementRoot,
    sourceRoot: params.sourceRoot,
    targetRoot: params.targetRoot,
    cutoverStore: params.cutoverStore,
    operationId: params.operationId,
    nowMs: params.nowMs,
    materialize: true,
  });
  if (!provision.ok) {
    throw new Error(`steward cutover provision failed: ${provision.reason}`);
  }
  // S26 reads the source canonical binding; S27 reads the target compatibility/read_only binding.
  const sourceBinding = provision.catalog.getBinding(provision.sourceBindingId);
  const targetBinding = provision.catalog.getBinding(provision.targetBindingId);
  if (!sourceBinding || !targetBinding) {
    throw new Error("steward cutover provision returned no bindings");
  }
  const operationId = provision.operation.operationId;
  let operation = provision.operation;
  // The command materialized (Catalog-first mkdir/copy) and created the fencing operation; advance the
  // cutover state machine to resolver_write_cutover without re-copying.
  const steps = [
    "prepared",
    "write_frozen",
    "copied_or_adopted",
    "verified",
    "dual_read_verified",
    "resolver_write_cutover",
  ] as const;
  for (const step of steps) {
    if (operation.state === step) {
      continue;
    }
    operation = advanceCutoverOperation({
      store: params.cutoverStore,
      operationId,
      nextState: step,
      nowMs: params.nowMs,
    });
  }
  return {
    operation,
    sourceRoot: sourceBinding.locator,
    targetRoot: targetBinding.locator,
    resourceId: provision.resourceId,
    sourceBindingId: provision.sourceBindingId,
    targetBindingId: provision.targetBindingId,
  };
}
