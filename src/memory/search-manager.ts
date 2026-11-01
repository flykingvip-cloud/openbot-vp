import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot, resolvePortableCanonicalStorePath } from "../config/data-space.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ResolvedCogniWeaveConfig } from "./backend-config.js";
import type { ResolvedQmdConfig } from "./backend-config.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import {
  resolveMemoryContinuityAuthz,
  type MemoryContinuityAuthzContext,
} from "./memory-continuity-authz.js";
import {
  memoryIndexAccessCacheComponent,
  type MemoryIndexAccessContext,
  resolveMemoryIndexAccess,
  type ResolvedMemoryIndexAccess,
} from "./memory-index-access-context.js";
import {
  fingerprintMemoryGovernance,
  getMemoryGovernanceEpoch,
  isManagedCogniWeaveTenant,
  type MemorySearchGovernance,
  bumpMemoryGovernanceEpoch,
} from "./memory-search-governance.js";
import { isMemoryWorkspaceHandle, type MemoryWorkspaceHandle } from "./memory-workspace-handle.js";
import { wrapMemorySearchManagerWithRecallDeny } from "./recall-deny-search-wrapper.js";
import type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySyncProgressUpdate,
} from "./types.js";

const log = createSubsystemLogger("memory");
const COGNIWEAVE_MANAGER_CACHE = new Map<string, MemorySearchManager>();
const QMD_MANAGER_CACHE = new Map<string, MemorySearchManager>();
const BUILTIN_WRAP_CACHE = new WeakMap<object, MemorySearchManager>();
let managerRuntimePromise: Promise<typeof import("./manager-runtime.js")> | null = null;

export {
  bumpMemoryGovernanceEpoch,
  buildMemorySearchGovernanceFromCallEntry,
  getMemoryGovernanceEpoch,
  isManagedCogniWeaveTenant,
  resetMemoryGovernanceEpochForTests,
  type MemorySearchGovernance,
} from "./memory-search-governance.js";

function loadManagerRuntime() {
  managerRuntimePromise ??= import("./manager-runtime.js");
  return managerRuntimePromise;
}

export type MemorySearchManagerResult = {
  manager: MemorySearchManager | null;
  error?: string;
};

/**
 * Flat data-plane routing for conversation purge / tenant isolation.
 *
 * Orthogonal to Item 7 Stage C structured `accessContext` (managed identity
 * thread on PR #709): `dataRoot` selects the filesystem plane, while
 * `accessContext` carries branded managed identity. Both may be present;
 * neither replaces the other.
 */
export type MemorySearchDataPlaneFields = {
  tenantId?: string | null;
  dataPlaneId?: string | null;
  dataRoot?: string | null;
};

export type MemorySearchManagerParams = {
  cfg: OpenBotConfig;
  agentId: string;
  purpose?: "default" | "status";
  /** Trusted governance from authenticated call entry (TenantContext / seat / group). */
  governance?: MemorySearchGovernance;
  /**
   * Item 7 Stage C: server-built structured access context. When it marks
   * managed_enterprise, the index workspace is resolved via the canonical
   * fail-closed resolver BEFORE any manager is built. Absent / personal_local
   * keeps the legacy resolveAgentWorkspaceDir path unchanged.
   */
  accessContext?: MemoryIndexAccessContext;
  /**
   * Authenticated human user id for collaboration membership checks
   * (members.json). Prefer governance ownershipProof when present; this is the
   * personal_local / explicit fallback.
   */
  authenticatedUserId?: string | null;
  /** Optional pre-resolved continuity authz (tests / callers that already computed it). */
  continuityAuthz?: MemoryContinuityAuthzContext;
} & MemorySearchDataPlaneFields;

/** Effective memory index/store root: explicit plane `dataRoot` wins over `resolveDataRoot(cfg)`. */
export function resolveMemorySearchManagerDataRoot(
  params: Pick<MemorySearchManagerParams, "cfg" | "dataRoot">,
): string {
  const explicit = params.dataRoot?.trim();
  return explicit ? explicit : resolveDataRoot(params.cfg);
}

function bindMemorySearchManagerParams<
  T extends { cfg: OpenBotConfig } & MemorySearchDataPlaneFields,
>(params: T): T {
  const explicitRoot = params.dataRoot?.trim();
  const explicitTenant = params.tenantId?.trim();
  if (!explicitRoot && !explicitTenant) {
    return params;
  }
  return {
    ...params,
    cfg: {
      ...params.cfg,
      data: {
        ...params.cfg.data,
        ...(explicitRoot ? { root: explicitRoot } : {}),
        ...(explicitTenant ? { tenantId: explicitTenant } : {}),
      },
    },
  };
}

function dataPlaneCacheComponent(params: MemorySearchDataPlaneFields): string {
  const tenant = params.tenantId?.trim() ?? "";
  const plane = params.dataPlaneId?.trim() ?? "";
  const root = params.dataRoot?.trim() ?? "";
  if (!tenant && !plane && !root) {
    return "";
  }
  return `plane:${tenant}:${plane}:${root}:`;
}

function withRecallDeny(
  manager: MemorySearchManager | null,
  dataRoot: string,
): MemorySearchManager | null {
  return wrapMemorySearchManagerWithRecallDeny(manager, dataRoot);
}

async function resolveBuiltinCollaborationRoots(
  params: MemorySearchManagerParams,
): Promise<MemoryContinuityAuthzContext> {
  if (params.continuityAuthz) {
    return params.continuityAuthz;
  }
  const profile =
    params.accessContext?.securityProfile === "managed_enterprise"
      ? "managed_enterprise"
      : "personal_local";
  return resolveMemoryContinuityAuthz({
    cfg: params.cfg,
    governance: params.governance,
    authenticatedUserId: params.authenticatedUserId,
    profile,
  });
}

export async function getMemorySearchManager(
  params: MemorySearchManagerParams,
): Promise<MemorySearchManagerResult> {
  const bound = bindMemorySearchManagerParams(params);
  const dataRoot = resolveMemorySearchManagerDataRoot(bound);
  // Item 7 Stage C identity thread: resolve the index workspace access ONCE,
  // fail-closed for managed_enterprise, before any manager / scan / index-write.
  let indexAccess: ResolvedMemoryIndexAccess = { profile: "personal_local" };
  // Tool entry often has continuityAuthz.profile and no full accessContext.
  // Both must fail closed on builtin/qmd. Do not treat that as personal_local.
  const managedEnterprise =
    params.accessContext?.securityProfile === "managed_enterprise" ||
    params.continuityAuthz?.profile === "managed_enterprise";
  if (managedEnterprise && bound.cfg.memory?.backend !== "cogniweave") {
    return { manager: null, error: "managed_backend_not_cogniweave" };
  }
  if (params.accessContext?.securityProfile === "managed_enterprise") {
    // Item 7 Stage C: a managed binding is honored only through the canonical
    // CogniWeave handle path below. The qmd/builtin local index roots
    // (backend-config.ts / manager.ts / qmd-manager.ts) are frozen by the Phase 0
    // retirement scan and cannot be tenant/resource-isolated in this slice, so a
    // managed tenant on a non-cogniweave backend fails closed here — it never
    // shares the legacy local root. Isolating those roots in place is deferred to
    // their retirement (which updates the CODEOWNERS-pinned freeze baseline).
    const access = await resolveMemoryIndexAccess(params.accessContext, {
      agentId: params.agentId,
      ledgerId: "S32",
    });
    if (!access.ok) {
      // Structured fail-closed: no manager, no scan, no index write.
      return {
        manager: null,
        error: access.canonicalReasonCode
          ? `${access.reasonCode}:${access.canonicalReasonCode}`
          : access.reasonCode,
      };
    }
    indexAccess = access.access;
  }
  // QMD collab collections need the same membership/tenant filter as builtin.
  // Resolve authz before backend config so we never dump all groups into QMD.
  let continuityAuthzForBackend: MemoryContinuityAuthzContext | undefined;
  if ((bound.cfg.memory?.backend ?? "builtin") === "qmd") {
    continuityAuthzForBackend = await resolveBuiltinCollaborationRoots(params);
  }
  const resolved = resolveMemoryBackendConfig({
    ...bound,
    ...(continuityAuthzForBackend
      ? {
          authorizedGroupIds: continuityAuthzForBackend.authorizedGroupIds,
          tenantId: continuityAuthzForBackend.tenantId,
          profile: continuityAuthzForBackend.profile,
        }
      : {}),
  });
  if (resolved.backend === "cogniweave" && resolved.cogniweave) {
    const statusOnly = params.purpose === "status";
    const cloudTenant = resolved.cogniweave.cloudSync?.tenantId?.trim() || null;
    const managedTenant =
      params.governance?.tenantId?.trim() ||
      (isManagedCogniWeaveTenant(cloudTenant) ? cloudTenant : null);
    if (managedTenant && !params.governance?.ownershipProof) {
      return {
        manager: null,
        error: "governance_write_denied:missing_ownership_proof",
      };
    }
    const governance: MemorySearchGovernance | undefined = params.governance
      ? {
          ...params.governance,
          tenantId: params.governance.tenantId ?? managedTenant,
        }
      : undefined;
    let cacheKey: string | undefined;
    if (!statusOnly) {
      cacheKey = buildCogniWeaveCacheKey(
        params.agentId,
        resolved.cogniweave,
        bound.cfg,
        governance,
        indexAccess,
        bound,
      );
      const cached = COGNIWEAVE_MANAGER_CACHE.get(cacheKey);
      if (cached) {
        return { manager: cached };
      }
    }
    try {
      const { CogniWeaveMemoryManager } = await import("./cogniweave-manager.js");
      let manager: MemorySearchManager;
      if (indexAccess.profile === "managed_enterprise") {
        // Managed: bind the manager to the canonical workspace handle (identity +
        // scope + permission gating). Fail-closed if the handle is rejected; never
        // falls back to the personal/legacy create path.
        const created = await CogniWeaveMemoryManager.createFromHandle({
          cfg: bound.cfg,
          agentId: params.agentId,
          resolved: resolved.cogniweave,
          handle: indexAccess.handle,
          governance: governance?.ownershipProof
            ? { ownershipProof: governance.ownershipProof, stateDir: governance.stateDir }
            : undefined,
        });
        if (!created.ok) {
          return { manager: null, error: created.reasonCode };
        }
        manager = created.manager;
      } else {
        manager = await CogniWeaveMemoryManager.create({
          cfg: bound.cfg,
          agentId: params.agentId,
          resolved: resolved.cogniweave,
          governance,
        });
      }
      if (statusOnly) {
        return { manager: withRecallDeny(manager, dataRoot) };
      }
      const wrapped = withRecallDeny(manager, dataRoot);
      if (cacheKey && wrapped) {
        COGNIWEAVE_MANAGER_CACHE.set(cacheKey, wrapped);
      }
      return { manager: wrapped };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { manager: null, error: message };
    }
  }

  if (resolved.backend === "qmd" && resolved.qmd) {
    const statusOnly = params.purpose === "status";
    let cacheKey: string | undefined;
    if (!statusOnly) {
      cacheKey = buildQmdCacheKey(params.agentId, resolved.qmd, bound);
      const cached = QMD_MANAGER_CACHE.get(cacheKey);
      if (cached) {
        return { manager: cached };
      }
    }
    try {
      const { QmdMemoryManager } = await import("./qmd-manager.js");
      const primary = await QmdMemoryManager.create({
        cfg: bound.cfg,
        agentId: params.agentId,
        resolved,
        mode: statusOnly ? "status" : "full",
      });
      if (primary) {
        if (statusOnly) {
          return { manager: withRecallDeny(primary, dataRoot) };
        }
        const wrapper = new FallbackMemoryManager(
          {
            primary,
            fallbackFactory: async () => {
              const { MemoryIndexManager } = await loadManagerRuntime();
              const authz =
                continuityAuthzForBackend ?? (await resolveBuiltinCollaborationRoots(params));
              return await MemoryIndexManager.get({
                ...bound,
                collaborationMemoryRoots: authz.roots,
                continuityIdentity: {
                  userId: authz.userId,
                  tenantId: authz.tenantId,
                },
              });
            },
          },
          () => {
            if (cacheKey) {
              QMD_MANAGER_CACHE.delete(cacheKey);
            }
          },
        );
        const wrapped = withRecallDeny(wrapper, dataRoot);
        if (cacheKey && wrapped) {
          QMD_MANAGER_CACHE.set(cacheKey, wrapped);
        }
        return { manager: wrapped };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`qmd memory unavailable; falling back to builtin: ${message}`);
    }
  }

  try {
    const { MemoryIndexManager } = await loadManagerRuntime();
    const authz = continuityAuthzForBackend ?? (await resolveBuiltinCollaborationRoots(params));
    const manager = await MemoryIndexManager.get({
      ...bound,
      collaborationMemoryRoots: authz.roots,
      continuityIdentity: {
        userId: authz.userId,
        tenantId: authz.tenantId,
      },
    });
    if (!manager) {
      return { manager: null };
    }
    const cachedWrap = BUILTIN_WRAP_CACHE.get(manager);
    if (cachedWrap) {
      return { manager: cachedWrap };
    }
    const wrapped = withRecallDeny(manager, dataRoot);
    if (wrapped) {
      BUILTIN_WRAP_CACHE.set(manager, wrapped);
    }
    return { manager: wrapped };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { manager: null, error: message };
  }
}

export async function getMemorySearchManagerFromHandle(
  params: {
    cfg: OpenBotConfig;
    agentId: string;
    handle: MemoryWorkspaceHandle;
    purpose?: "default" | "status";
    governance?: MemorySearchGovernance;
  } & MemorySearchDataPlaneFields,
): Promise<MemorySearchManagerResult> {
  if (!isMemoryWorkspaceHandle(params.handle)) {
    return { manager: null, error: "handle_not_branded" };
  }
  const bound = bindMemorySearchManagerParams(params);
  const dataRoot = resolveMemorySearchManagerDataRoot(bound);
  const resolved = resolveMemoryBackendConfig(bound);
  if (resolved.backend !== "cogniweave" || !resolved.cogniweave) {
    return { manager: null, error: "cogniweave_backend_required" };
  }
  try {
    const { CogniWeaveMemoryManager } = await import("./cogniweave-manager.js");
    const created = await CogniWeaveMemoryManager.createFromHandle({
      cfg: bound.cfg,
      resolved: resolved.cogniweave,
      handle: params.handle,
      ["agentId"]: params.agentId,
      governance: params.governance?.ownershipProof
        ? {
            ownershipProof: params.governance.ownershipProof,
            stateDir: params.governance.stateDir,
          }
        : undefined,
    });
    if (!created.ok) {
      return { manager: null, error: created.reasonCode };
    }
    return { manager: withRecallDeny(created.manager, dataRoot) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { manager: null, error: message };
  }
}

export async function closeAllMemorySearchManagers(): Promise<void> {
  const managers = [
    ...Array.from(COGNIWEAVE_MANAGER_CACHE.values()),
    ...Array.from(QMD_MANAGER_CACHE.values()),
  ];
  COGNIWEAVE_MANAGER_CACHE.clear();
  QMD_MANAGER_CACHE.clear();
  for (const manager of managers) {
    try {
      await manager.close?.();
    } catch (err) {
      log.warn(`failed to close qmd memory manager: ${String(err)}`);
    }
  }
  if (managerRuntimePromise !== null) {
    const { closeAllMemoryIndexManagers } = await loadManagerRuntime();
    await closeAllMemoryIndexManagers();
  }
}

/**
 * Seat transfer / governance epoch change: bump epoch (new cache keys) and drop
 * cached CogniWeave managers so the next call rebuilds with fresh proof.
 *
 * Sync path is required for seat identity changes: epoch + cache clear must complete
 * before the mutation API returns so the next request cannot hit a stale manager.
 */
export function invalidateCogniWeaveManagersForGovernanceChangeSync(): number {
  const epoch = bumpMemoryGovernanceEpoch();
  const managers = [...COGNIWEAVE_MANAGER_CACHE.values()];
  COGNIWEAVE_MANAGER_CACHE.clear();
  for (const manager of managers) {
    void Promise.resolve()
      .then(async () => manager.close?.())
      .catch((err) => {
        log.error(`failed to close cogniweave manager after governance invalidate: ${String(err)}`);
      });
  }
  return epoch;
}

export async function invalidateCogniWeaveManagersForGovernanceChange(): Promise<void> {
  invalidateCogniWeaveManagersForGovernanceChangeSync();
}

class FallbackMemoryManager implements MemorySearchManager {
  private fallback: MemorySearchManager | null = null;
  private primaryFailed = false;
  private lastError?: string;
  private cacheEvicted = false;

  constructor(
    private readonly deps: {
      primary: MemorySearchManager;
      fallbackFactory: () => Promise<MemorySearchManager | null>;
    },
    private readonly onClose?: () => void,
  ) {}

  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ) {
    if (!this.primaryFailed) {
      try {
        return await this.deps.primary.search(query, opts);
      } catch (err) {
        this.primaryFailed = true;
        this.lastError = err instanceof Error ? err.message : String(err);
        log.warn(`qmd memory failed; switching to builtin index: ${this.lastError}`);
        await this.deps.primary.close?.().catch(() => {});
        // Evict the failed wrapper so the next request can retry QMD with a fresh manager.
        this.evictCacheEntry();
      }
    }
    const fallback = await this.ensureFallback();
    if (fallback) {
      return await fallback.search(query, opts);
    }
    throw new Error(this.lastError ?? "memory search unavailable");
  }

  async readFile(params: { relPath: string; from?: number; lines?: number }) {
    if (!this.primaryFailed) {
      return await this.deps.primary.readFile(params);
    }
    const fallback = await this.ensureFallback();
    if (fallback) {
      return await fallback.readFile(params);
    }
    throw new Error(this.lastError ?? "memory read unavailable");
  }

  status() {
    if (!this.primaryFailed) {
      return this.deps.primary.status();
    }
    const fallbackStatus = this.fallback?.status();
    const fallbackInfo = { from: "qmd", reason: this.lastError ?? "unknown" };
    if (fallbackStatus) {
      const custom = fallbackStatus.custom ?? {};
      return {
        ...fallbackStatus,
        fallback: fallbackInfo,
        custom: {
          ...custom,
          fallback: { disabled: true, reason: this.lastError ?? "unknown" },
        },
      };
    }
    const primaryStatus = this.deps.primary.status();
    const custom = primaryStatus.custom ?? {};
    return {
      ...primaryStatus,
      fallback: fallbackInfo,
      custom: {
        ...custom,
        fallback: { disabled: true, reason: this.lastError ?? "unknown" },
      },
    };
  }

  async sync(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }) {
    if (!this.primaryFailed) {
      await this.deps.primary.sync?.(params);
      return;
    }
    const fallback = await this.ensureFallback();
    await fallback?.sync?.(params);
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    if (!this.primaryFailed) {
      return await this.deps.primary.probeEmbeddingAvailability();
    }
    const fallback = await this.ensureFallback();
    if (fallback) {
      return await fallback.probeEmbeddingAvailability();
    }
    return { ok: false, error: this.lastError ?? "memory embeddings unavailable" };
  }

  async probeVectorAvailability() {
    if (!this.primaryFailed) {
      return await this.deps.primary.probeVectorAvailability();
    }
    const fallback = await this.ensureFallback();
    return (await fallback?.probeVectorAvailability()) ?? false;
  }

  async close() {
    await this.deps.primary.close?.();
    await this.fallback?.close?.();
    this.evictCacheEntry();
  }

  private async ensureFallback(): Promise<MemorySearchManager | null> {
    if (this.fallback) {
      return this.fallback;
    }
    let fallback: MemorySearchManager | null;
    try {
      fallback = await this.deps.fallbackFactory();
      if (!fallback) {
        log.warn("memory fallback requested but builtin index is unavailable");
        return null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`memory fallback unavailable: ${message}`);
      return null;
    }
    this.fallback = fallback;
    return this.fallback;
  }

  private evictCacheEntry(): void {
    if (this.cacheEvicted) {
      return;
    }
    this.cacheEvicted = true;
    this.onClose?.();
  }
}

function buildQmdCacheKey(
  agentId: string,
  config: ResolvedQmdConfig,
  plane?: MemorySearchDataPlaneFields,
): string {
  // ResolvedQmdConfig is assembled in a stable field order in resolveMemoryBackendConfig.
  // Fast stringify avoids deep key-sorting overhead on this hot path.
  const prefix = plane ? dataPlaneCacheComponent(plane) : "";
  return `${prefix}${agentId}:${JSON.stringify(config)}`;
}

function buildCogniWeaveCacheKey(
  agentId: string,
  config: ResolvedCogniWeaveConfig,
  cfg: OpenBotConfig,
  governance: MemorySearchGovernance | undefined,
  indexAccess: ResolvedMemoryIndexAccess,
  plane?: MemorySearchDataPlaneFields,
): string {
  const dataRoot = resolveDataRoot(cfg);
  const storePath = config.storePath?.trim() || resolvePortableCanonicalStorePath(dataRoot);
  const gov = fingerprintMemoryGovernance(governance);
  const epoch = getMemoryGovernanceEpoch();
  const access = memoryIndexAccessCacheComponent(indexAccess);
  const prefix = plane ? dataPlaneCacheComponent(plane) : "";
  return `${prefix}${access}:${agentId}:${dataRoot}:${storePath}:${gov}:epoch:${epoch}:${JSON.stringify(config)}`;
}
