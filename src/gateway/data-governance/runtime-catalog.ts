import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import type { WorkspaceOwnerScope } from "../workspace/types.js";
import {
  createCachedDataGovernanceCatalog,
  type CachedDataGovernanceCatalog,
} from "./catalog-cache.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import { assertWritableEnvelope } from "./envelope.js";
import { verifyGovernanceOpMarker } from "./operation-marker.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { writeGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import type {
  CatalogRecord,
  DataClassification,
  DataGovernanceEnvelope,
  GovernedResourceType,
  LifecycleState,
  OwnershipPrincipal,
  ResourceScope,
} from "./types.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";

export type QuarantinePathResult =
  | { status: "quarantined"; dest: string }
  | {
      status: "skipped";
      reason: "missing" | "no_marker" | "not_allowed" | "shared_aggregate_logical_compensate";
    }
  | { status: "failed"; error: string };

let sharedCatalog: CachedDataGovernanceCatalog | null = null;
let sharedStorePath: string | null = null;

/** Process-wide durable catalog (metadata-only). */
export function getSharedDataGovernanceCatalog(opts?: {
  stateDir?: string;
}): CachedDataGovernanceCatalog {
  const storePath = resolveDataGovernanceCatalogPath(opts?.stateDir ?? resolveStateDir());
  if (!sharedCatalog || sharedStorePath !== storePath) {
    const store = getOrCreateFileDataGovernanceCatalogStore({ storePath });
    sharedCatalog = createCachedDataGovernanceCatalog({ store });
    sharedStorePath = storePath;
  }
  return sharedCatalog;
}

/** Test helper — drop singleton so a new stateDir can be used. */
export function resetSharedDataGovernanceCatalogForTests(): void {
  sharedCatalog = null;
  sharedStorePath = null;
  resetCatalogStoreSingletonsForTests();
}

export function mapWorkspaceClassification(raw: string): DataClassification {
  switch (raw) {
    case "employee_private":
      return "restricted";
    case "group_workspace":
    case "agent_workspace":
      return "internal";
    case "public":
    case "internal":
    case "confidential":
    case "restricted":
      return raw;
    default:
      return "internal";
  }
}

export function mapOwnerAndScope(
  ownerScope: WorkspaceOwnerScope,
  tenantId: string | null,
): { owner: OwnershipPrincipal; scope: ResourceScope } {
  switch (ownerScope.kind) {
    case "user_owned":
      return {
        owner: { kind: "user", userId: ownerScope.userId },
        scope: { kind: "user", userId: ownerScope.userId },
      };
    case "position_owned":
      return {
        owner: { kind: "position", seatId: ownerScope.seatId },
        scope: tenantId ? { kind: "tenant", tenantId } : { kind: "system" },
      };
    case "group_owned":
      return {
        owner: { kind: "group", groupId: ownerScope.groupId },
        scope: { kind: "group", groupId: ownerScope.groupId },
      };
    case "unknown":
      throw new Error("governance_catalog_invalid:unknown_ownership");
  }
}

function buildRecord(params: {
  resourceId: string;
  resourceType: GovernedResourceType;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  scope: ResourceScope;
  classification: DataClassification;
  locator: string;
  lifecycleState: LifecycleState;
  existing?: CatalogRecord | null;
}): CatalogRecord {
  const now = new Date().toISOString();
  const bindingId =
    params.existing?.envelope.canonicalBindingId ?? `canonical:${params.resourceId}`;
  const envelope: DataGovernanceEnvelope = {
    resourceId: params.resourceId,
    resourceType: params.resourceType,
    schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
    tenantId: params.tenantId,
    owner: params.owner,
    scope: params.scope,
    lifecycleState: params.lifecycleState,
    classification: params.classification,
    governanceVersion: (params.existing?.envelope.governanceVersion ?? 0) + 1,
    canonicalBindingId: bindingId,
    createdAt: params.existing?.envelope.createdAt ?? now,
    updatedAt: now,
  };
  return {
    envelope,
    bindings: [
      {
        bindingId,
        resourceId: params.resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: params.locator,
        state: params.lifecycleState === "pending" ? "active" : "active",
        contentVersion: String(envelope.governanceVersion),
      },
    ],
  };
}

function isPathInsideOrEqual(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  return c === r || c.startsWith(`${r}${path.sep}`);
}

/**
 * Quarantine a path owned by operationId (marker-verified).
 * Pre-existing dirs without a matching marker are skipped — never moved/deleted.
 */
export async function quarantinePath(params: {
  targetPath: string;
  reason: string;
  stateDir?: string;
  operationId: string;
  kind: "directory" | "file";
  allowedRoots: string[];
}): Promise<QuarantinePathResult> {
  const target = path.resolve(params.targetPath);
  if (!fs.existsSync(target)) {
    return { status: "skipped", reason: "missing" };
  }
  if (
    !verifyGovernanceOpMarker({
      targetPath: target,
      operationId: params.operationId,
      kind: params.kind,
    })
  ) {
    return { status: "skipped", reason: "no_marker" };
  }
  const stateDir = path.resolve(params.stateDir ?? resolveStateDir());
  if (
    target === stateDir ||
    isPathInsideOrEqual(target, stateDir) ||
    target === path.parse(target).root
  ) {
    return { status: "skipped", reason: "not_allowed" };
  }
  const allowed = params.allowedRoots.map((root) => path.resolve(root)).filter(Boolean);
  if (allowed.length === 0) {
    return { status: "skipped", reason: "not_allowed" };
  }
  const underAllowed = allowed.some((root) => target === root || isPathInsideOrEqual(root, target));
  if (!underAllowed) {
    return { status: "skipped", reason: "not_allowed" };
  }
  const allowedIsSafe = allowed.every(
    (root) =>
      root !== stateDir && !isPathInsideOrEqual(root, stateDir) && root !== path.parse(root).root,
  );
  if (!allowedIsSafe) {
    return { status: "skipped", reason: "not_allowed" };
  }

  const root = path.join(stateDir, "data-governance", "quarantine");
  fs.mkdirSync(root, { recursive: true });
  const dest = path.join(
    root,
    `${Date.now()}-${randomUUID().slice(0, 8)}-${path.basename(target)}`,
  );
  try {
    try {
      fs.renameSync(target, dest);
    } catch {
      fs.cpSync(target, dest, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
    fs.writeFileSync(
      `${dest}.receipt.json`,
      `${JSON.stringify(
        {
          reason: params.reason,
          originalPath: target,
          operationId: params.operationId,
          quarantinedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return { status: "quarantined", dest };
  } catch (err) {
    return { status: "failed", error: String((err as Error)?.message ?? err) };
  }
}

/** Prefer `transitionCatalogLifecycleCommand` for P2 lifecycle commands. */
export async function transitionCatalogLifecycle(params: {
  resourceId: string;
  lifecycleState: LifecycleState;
  stateDir?: string;
}): Promise<boolean> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    return false;
  }
  await catalog.put({
    envelope: {
      ...existing.envelope,
      lifecycleState: params.lifecycleState,
      governanceVersion: existing.envelope.governanceVersion + 1,
      updatedAt: new Date().toISOString(),
    },
    bindings: existing.bindings,
  });
  return true;
}

/** Mark catalog rows recovery_required without touching filesystem. */
export async function markCatalogRecoveryRequired(params: {
  resourceIds: string[];
  stateDir?: string;
}): Promise<void> {
  for (const resourceId of params.resourceIds) {
    await transitionCatalogLifecycle({
      resourceId,
      lifecycleState: "recovery_required",
      stateDir: params.stateDir,
    });
  }
}

export async function upsertWorkspaceGovernanceRecord(params: {
  resourceId: string;
  tenantId: string | null;
  ownerScope: WorkspaceOwnerScope;
  locator: string;
  classification: string;
  lifecycleState?: LifecycleState;
  stateDir?: string;
}): Promise<CatalogRecord> {
  if (params.ownerScope.kind === "unknown") {
    throw new Error("governance_catalog_invalid:unknown_ownership");
  }
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (existing) {
    // First-registration only for lifecycle. Never implicitly reactivate
    // recovery_required / quarantined / archived / etc. on ordinary access.
    const lifecycle = existing.envelope.lifecycleState;
    if (lifecycle === "active") {
      const canonical = existing.bindings.find(
        (b) => b.bindingId === existing.envelope.canonicalBindingId && b.role === "canonical",
      );
      const locatorReal = path.resolve(params.locator);
      if (canonical && path.resolve(canonical.locator) !== locatorReal) {
        const now = new Date().toISOString();
        const next: CatalogRecord = {
          envelope: {
            ...existing.envelope,
            governanceVersion: existing.envelope.governanceVersion + 1,
            updatedAt: now,
          },
          bindings: [
            {
              ...canonical,
              locator: locatorReal,
              contentVersion: String(existing.envelope.governanceVersion + 1),
            },
            ...existing.bindings.filter((b) => b.bindingId !== canonical.bindingId),
          ],
        };
        await catalog.put(next);
        return next;
      }
    }
    return existing;
  }

  const mapped = mapOwnerAndScope(params.ownerScope, params.tenantId);
  const created = buildRecord({
    resourceId: params.resourceId,
    resourceType: "workspace",
    tenantId: params.tenantId,
    owner: mapped.owner,
    scope: mapped.scope,
    classification: mapWorkspaceClassification(params.classification),
    locator: params.locator,
    lifecycleState: params.lifecycleState ?? "active",
    existing: null,
  });
  await catalog.put(created);
  return created;
}

/** Map durable Catalog workspace row into resolver projection records. */
export function projectDurableWorkspaceToResolver(params: {
  record: CatalogRecord;
  /** Fallback owner scope when Catalog owner cannot be fully reconstructed (should be rare). */
  fallbackOwnerScope?: WorkspaceOwnerScope;
}): {
  resource: import("../workspace/types.js").WorkspaceResourceRecord;
  bindings: import("../workspace/types.js").WorkspaceBindingRecord[];
} {
  const { record } = params;
  const ownerScope =
    mapCatalogOwnerToWorkspaceOwnerScope(record) ??
    params.fallbackOwnerScope ??
    ({ kind: "unknown", reason: "catalog_owner_unmapped" } as const);

  const lifecycleState = mapGovernanceLifecycleToWorkspace(record.envelope.lifecycleState);
  const resource = {
    resourceId: record.envelope.resourceId,
    resourceType: "workspace" as const,
    tenantId: record.envelope.tenantId,
    ownerScope,
    lifecycleState,
    classification: record.envelope.classification,
    governanceVersion: record.envelope.governanceVersion,
  };

  const bindings = record.bindings
    .filter((b) => b.role === "canonical" || b.role === "compatibility")
    .map((b) => ({
      bindingId: b.bindingId,
      resourceId: b.resourceId,
      role: b.role === "compatibility" ? ("compatibility" as const) : ("canonical" as const),
      locator: b.locator,
      state:
        b.state === "active"
          ? ("active" as const)
          : b.state === "read_only"
            ? ("read_only" as const)
            : ("retired" as const),
      contentVersion: b.contentVersion,
    }));

  return { resource, bindings };
}

export function mapGovernanceLifecycleToWorkspace(
  state: LifecycleState,
): import("../workspace/types.js").WorkspaceResourceRecord["lifecycleState"] {
  switch (state) {
    case "active":
      return "active";
    case "read_only":
      return "read_only";
    case "pending":
      return "pending";
    case "recovery_required":
      return "recovery_required";
    case "quarantined":
      return "quarantined";
    case "archived":
      return "archived";
    case "deletion_pending":
      return "archived";
    case "retired":
    case "purged":
      return "retired";
    default:
      return "retired";
  }
}

function mapCatalogOwnerToWorkspaceOwnerScope(
  record: CatalogRecord,
): import("../workspace/types.js").WorkspaceOwnerScope | null {
  const owner = record.envelope.owner;
  if (owner.kind === "position") {
    return {
      kind: "position_owned",
      seatId: owner.seatId,
      agentAssetId: `catalog:${record.envelope.resourceId}`,
    };
  }
  if (owner.kind === "group") {
    return { kind: "group_owned", groupId: owner.groupId };
  }
  if (owner.kind === "user") {
    return {
      kind: "user_owned",
      userId: owner.userId,
      agentAssetId: `catalog:${record.envelope.resourceId}`,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: owner.userId,
        agentAssetId: `catalog:${record.envelope.resourceId}`,
      },
    };
  }
  return null;
}

function resolveAgentOwnerScope(params: {
  tenantId: string | null;
  ownerUserId: string | null;
  ownerPositionId: string | null;
}): { owner: OwnershipPrincipal; scope: ResourceScope } {
  if (params.ownerPositionId) {
    return {
      owner: { kind: "position", seatId: params.ownerPositionId },
      scope: params.tenantId ? { kind: "tenant", tenantId: params.tenantId } : { kind: "system" },
    };
  }
  if (params.ownerUserId) {
    return {
      owner: { kind: "user", userId: params.ownerUserId },
      scope: { kind: "user", userId: params.ownerUserId },
    };
  }
  throw new Error("governance_catalog_invalid:missing_owner");
}

export function resolveAgentGovernanceIds(params: {
  agentId: string;
  tenantId: string | null;
  workspaceLocator: string;
}): { agentResourceId: string; workspaceResourceId: string } {
  return {
    agentResourceId: `agent:${params.tenantId ?? "local"}:${params.agentId}`,
    workspaceResourceId: createHash("sha256")
      .update(`ws:${params.tenantId ?? "local"}:${params.agentId}:${params.workspaceLocator}`)
      .digest("hex")
      .slice(0, 32),
  };
}

/** Pre-register agent+workspace as pending before physical materialization. */
export async function beginAgentGovernanceRegistration(params: {
  agentId: string;
  tenantId: string | null;
  ownerUserId: string | null;
  ownerPositionId: string | null;
  workspaceLocator: string;
  agentDirLocator: string;
  stateDir?: string;
}): Promise<{ agentResourceId: string; workspaceResourceId: string }> {
  if (!params.tenantId) {
    throw new Error("governance_catalog_invalid:managed_tenant_required");
  }
  const mapped = resolveAgentOwnerScope(params);
  const ids = resolveAgentGovernanceIds(params);
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const storePath = resolveDataGovernanceCatalogPath(params.stateDir ?? resolveStateDir());
  const store = getOrCreateFileDataGovernanceCatalogStore({ storePath });

  await catalog.put(
    buildRecord({
      resourceId: ids.agentResourceId,
      resourceType: "agent",
      tenantId: params.tenantId,
      owner: mapped.owner,
      scope: mapped.scope,
      classification: "internal",
      locator: path.resolve(params.agentDirLocator),
      lifecycleState: "pending",
    }),
  );
  try {
    await catalog.put(
      buildRecord({
        resourceId: ids.workspaceResourceId,
        resourceType: "workspace",
        tenantId: params.tenantId,
        owner: mapped.owner,
        scope: mapped.scope,
        classification: "internal",
        locator: path.resolve(params.workspaceLocator),
        lifecycleState: "pending",
      }),
    );
  } catch (err) {
    // Compensate partial dual-write so callers never see orphan agent pending rows.
    await store.remove(ids.agentResourceId);
    catalog.invalidate(ids.agentResourceId);
    throw err;
  }
  return ids;
}

export async function activateAgentGovernanceRegistration(params: {
  agentResourceId: string;
  workspaceResourceId: string;
  stateDir?: string;
}): Promise<void> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  for (const resourceId of [params.agentResourceId, params.workspaceResourceId]) {
    const existing = await catalog.get(resourceId);
    if (!existing) {
      throw new Error(`governance_catalog_invalid:missing_pending:${resourceId}`);
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
}

export type AbortGovernanceResult = {
  /** True when catalog rows remain in recovery_required (quarantine incomplete). */
  recoveryRequired: boolean;
  quarantinedPaths: string[];
};

/**
 * Abort create: mark recovery_required → marker-gated quarantine → quarantined.
 * Never hard-deletes catalog rows before physical isolation succeeds.
 */
export async function abortAgentGovernanceRegistration(params: {
  agentResourceId: string;
  workspaceResourceId: string;
  workspaceLocator: string;
  agentDirLocator: string;
  transcriptsDir?: string;
  reason: string;
  operationId: string;
  stateDir?: string;
  allowedRoots: string[];
  /**
   * When side-effect compensate failed, keep catalog at recovery_required even if
   * physical quarantine of marked paths succeeded.
   */
  finalizeLifecycle?: "quarantined" | "recovery_required";
}): Promise<AbortGovernanceResult> {
  const finalize = params.finalizeLifecycle ?? "quarantined";
  const resourceIds = [params.agentResourceId, params.workspaceResourceId];
  for (const resourceId of resourceIds) {
    await transitionCatalogLifecycle({
      resourceId,
      lifecycleState: "recovery_required",
      stateDir: params.stateDir,
    });
  }

  const attempts: Array<{ path: string; result: QuarantinePathResult }> = [];
  for (const targetPath of [params.workspaceLocator, params.agentDirLocator]) {
    attempts.push({
      path: targetPath,
      result: await quarantinePath({
        targetPath,
        reason: params.reason,
        stateDir: params.stateDir,
        operationId: params.operationId,
        kind: "directory",
        allowedRoots: params.allowedRoots,
      }),
    });
  }
  if (params.transcriptsDir) {
    attempts.push({
      path: params.transcriptsDir,
      result: await quarantinePath({
        targetPath: params.transcriptsDir,
        reason: params.reason,
        stateDir: params.stateDir,
        operationId: params.operationId,
        kind: "directory",
        allowedRoots: params.allowedRoots,
      }),
    });
  }

  const failed = attempts.filter((a) => a.result.status === "failed");
  const quarantinedPaths = attempts
    .filter((a) => a.result.status === "quarantined")
    .map((a) => (a.result.status === "quarantined" ? a.result.dest : ""))
    .filter(Boolean);

  if (failed.length > 0 || finalize === "recovery_required") {
    if (failed.length > 0) {
      writeGovernanceRecoveryReceipt({
        operationId: params.operationId,
        stage: "agent_quarantine",
        reason: params.reason,
        error: failed.map((f) => `${f.path}:${(f.result as { error: string }).error}`).join(";"),
        resourceIds,
        haltCompensation: false,
        stateDir: params.stateDir,
      });
    }
    // Stay recovery_required — do not claim quarantined completion.
    return { recoveryRequired: true, quarantinedPaths };
  }

  for (const resourceId of resourceIds) {
    await transitionCatalogLifecycle({
      resourceId,
      lifecycleState: "quarantined",
      stateDir: params.stateDir,
    });
  }
  return { recoveryRequired: false, quarantinedPaths };
}

/** @deprecated prefer begin/activate for create flows; kept for handler-bridge active upserts */
export async function upsertAgentGovernanceRecord(params: {
  agentId: string;
  tenantId: string | null;
  ownerUserId: string | null;
  ownerPositionId: string | null;
  workspaceLocator: string;
  agentDirLocator: string;
  lifecycleState?: LifecycleState;
  stateDir?: string;
}): Promise<{ agentResourceId: string; workspaceResourceId: string }> {
  if (params.lifecycleState === "pending") {
    return beginAgentGovernanceRegistration(params);
  }
  const ids = await beginAgentGovernanceRegistration(params);
  await activateAgentGovernanceRegistration({ ...ids, stateDir: params.stateDir });
  return ids;
}

export function resolveConversationArchiveResourceId(params: {
  transcriptPath: string;
  sessionId: string;
  tenantId: string | null;
}): string {
  return createHash("sha256")
    .update(`archive:${params.tenantId ?? "local"}:${params.sessionId}:${params.transcriptPath}`)
    .digest("hex")
    .slice(0, 32);
}

function resolveConversationOwner(params: {
  tenantId: string | null;
  ownerUserId: string | null;
  groupId?: string | null;
  requireIdentity: boolean;
}): { owner: OwnershipPrincipal; scope: ResourceScope } {
  if (params.groupId) {
    return {
      owner: { kind: "group", groupId: params.groupId },
      scope: { kind: "group", groupId: params.groupId },
    };
  }
  if (params.ownerUserId) {
    return {
      owner: { kind: "user", userId: params.ownerUserId },
      scope: { kind: "user", userId: params.ownerUserId },
    };
  }
  if (params.requireIdentity) {
    throw new Error("governance_catalog_invalid:missing_conversation_owner");
  }
  return {
    owner: { kind: "system", systemId: "conversation-archive" },
    scope: params.tenantId ? { kind: "tenant", tenantId: params.tenantId } : { kind: "system" },
  };
}

export async function beginConversationArchiveGovernanceRegistration(params: {
  transcriptPath: string;
  sessionId: string;
  tenantId: string | null;
  ownerUserId: string | null;
  groupId?: string | null;
  requireIdentity?: boolean;
  stateDir?: string;
}): Promise<string> {
  const requireIdentity = params.requireIdentity ?? Boolean(params.tenantId);
  if (requireIdentity && !params.tenantId) {
    throw new Error("governance_catalog_invalid:managed_tenant_required");
  }
  const mapped = resolveConversationOwner({
    tenantId: params.tenantId,
    ownerUserId: params.ownerUserId,
    groupId: params.groupId,
    requireIdentity,
  });
  const resourceId = resolveConversationArchiveResourceId(params);
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(resourceId);
  await catalog.put(
    buildRecord({
      resourceId,
      resourceType: "conversation_archive",
      tenantId: params.tenantId,
      owner: mapped.owner,
      scope: mapped.scope,
      classification: "confidential",
      locator: path.resolve(params.transcriptPath),
      lifecycleState: "pending",
      existing,
    }),
  );
  return resourceId;
}

export async function activateConversationArchiveGovernanceRegistration(params: {
  resourceId: string;
  stateDir?: string;
}): Promise<void> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(params.resourceId);
  if (!existing) {
    throw new Error(`governance_catalog_invalid:missing_pending:${params.resourceId}`);
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

/**
 * Managed content-write gate for conversation archives.
 * Requires a catalog row with lifecycleState === "active".
 * Catalog state transitions must use assertCatalogMutableEnvelope via put(), not this helper.
 */
export async function assertConversationArchiveContentWritable(params: {
  transcriptPath: string;
  sessionId: string;
  tenantId: string | null;
  stateDir?: string;
}): Promise<void> {
  const resourceId = resolveConversationArchiveResourceId(params);
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const existing = await catalog.get(resourceId);
  if (!existing) {
    throw new Error("governance_catalog_missing:conversation_archive");
  }
  assertWritableEnvelope(existing.envelope);
}

export async function abortConversationArchiveGovernanceRegistration(params: {
  resourceId: string;
  transcriptPath: string;
  reason: string;
  operationId: string;
  stateDir?: string;
  allowedRoots: string[];
}): Promise<AbortGovernanceResult> {
  await transitionCatalogLifecycle({
    resourceId: params.resourceId,
    lifecycleState: "recovery_required",
    stateDir: params.stateDir,
  });

  const transcriptPath = path.resolve(params.transcriptPath);
  const hasMarker = verifyGovernanceOpMarker({
    targetPath: transcriptPath,
    operationId: params.operationId,
    kind: "file",
  });

  if (!hasMarker) {
    // Pre-existing / foreign file: keep catalog in recovery_required for operator review,
    // but do not unlink or move the transcript.
    writeGovernanceRecoveryReceipt({
      operationId: params.operationId,
      stage: "conversation_abort_no_marker",
      reason: params.reason,
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
    await transitionCatalogLifecycle({
      resourceId: params.resourceId,
      lifecycleState: "quarantined",
      stateDir: params.stateDir,
    });
    return { recoveryRequired: false, quarantinedPaths: [] };
  }

  if (!fs.existsSync(transcriptPath)) {
    await transitionCatalogLifecycle({
      resourceId: params.resourceId,
      lifecycleState: "quarantined",
      stateDir: params.stateDir,
    });
    return { recoveryRequired: false, quarantinedPaths: [] };
  }

  try {
    const st = fs.statSync(transcriptPath);
    if (st.isFile()) {
      const stateDir = path.resolve(params.stateDir ?? resolveStateDir());
      const root = path.join(stateDir, "data-governance", "quarantine");
      fs.mkdirSync(root, { recursive: true });
      const dest = path.join(
        root,
        `${Date.now()}-${randomUUID().slice(0, 8)}-${path.basename(transcriptPath)}`,
      );
      fs.renameSync(transcriptPath, dest);
      // Best-effort: move sibling marker with the file.
      const markerSibling = `${transcriptPath}.openbot-gov-op.json`;
      if (fs.existsSync(markerSibling)) {
        try {
          fs.renameSync(markerSibling, `${dest}.openbot-gov-op.json`);
        } catch {
          // ignore
        }
      }
      fs.writeFileSync(
        `${dest}.receipt.json`,
        `${JSON.stringify(
          {
            reason: params.reason,
            originalPath: transcriptPath,
            operationId: params.operationId,
            quarantinedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await transitionCatalogLifecycle({
        resourceId: params.resourceId,
        lifecycleState: "quarantined",
        stateDir: params.stateDir,
      });
      return { recoveryRequired: false, quarantinedPaths: [dest] };
    }
  } catch (err) {
    writeGovernanceRecoveryReceipt({
      operationId: params.operationId,
      stage: "conversation_quarantine",
      reason: params.reason,
      error: String((err as Error)?.message ?? err),
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
    return { recoveryRequired: true, quarantinedPaths: [] };
  }

  const q = await quarantinePath({
    targetPath: transcriptPath,
    reason: params.reason,
    stateDir: params.stateDir,
    operationId: params.operationId,
    kind: "file",
    allowedRoots: params.allowedRoots,
  });
  if (q.status === "failed") {
    writeGovernanceRecoveryReceipt({
      operationId: params.operationId,
      stage: "conversation_quarantine",
      reason: params.reason,
      error: q.error,
      resourceIds: [params.resourceId],
      haltCompensation: false,
      stateDir: params.stateDir,
    });
    return { recoveryRequired: true, quarantinedPaths: [] };
  }
  await transitionCatalogLifecycle({
    resourceId: params.resourceId,
    lifecycleState: "quarantined",
    stateDir: params.stateDir,
  });
  return {
    recoveryRequired: false,
    quarantinedPaths: q.status === "quarantined" ? [q.dest] : [],
  };
}

export async function upsertConversationArchiveGovernanceRecord(params: {
  transcriptPath: string;
  sessionId: string;
  tenantId: string | null;
  ownerUserId: string | null;
  groupId?: string | null;
  lifecycleState?: LifecycleState;
  requireIdentity?: boolean;
  stateDir?: string;
}): Promise<string> {
  const resourceId = await beginConversationArchiveGovernanceRegistration({
    ...params,
    requireIdentity: params.requireIdentity,
  });
  if ((params.lifecycleState ?? "active") === "active") {
    await activateConversationArchiveGovernanceRegistration({
      resourceId,
      stateDir: params.stateDir,
    });
  }
  return resourceId;
}
