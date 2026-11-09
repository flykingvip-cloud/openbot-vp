/**
 * P0-c handler bridge: authorize workspace file access through classifier + resolver.
 *
 * Authority model (P1-2 Gate Repair):
 * - Durable governance Catalog (`getSharedDataGovernanceCatalog`) is the single
 *   governance SoT for inventory, recovery, and cross-restart bindings.
 * - `processCatalog` is an ephemeral resolver projection only — seeded AFTER a
 *   successful durable upsert (or steward local-only path). It must never diverge
 *   as a competing write authority for managed governance.
 */

import fs from "node:fs";
import path from "node:path";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
import {
  getSharedDataGovernanceCatalog,
  projectDurableWorkspaceToResolver,
  upsertWorkspaceGovernanceRecord,
} from "../data-governance/runtime-catalog.js";
import { resolveSecurityProfile } from "../security-profile.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  resolveTenantContextForSessionStore,
  type TenantContext,
} from "../tenant-context.js";
import { personalWorkbenchSessionNeedsActor } from "../employee-workbench-actor-restore.js";
import { resolveAgentsHandlerWorkspaceLocator } from "../server-methods/agents-handler-workspace-locator.js";
import { assertGroupMemberAccess } from "./group-acl.js";
import { resolveTrustedGroupLocator } from "./group-locator.js";
import { classifyWorkspaceOwnership, isWritableWorkspaceScope } from "./ownership-classifier.js";
import {
  isFilesystemWorkspaceLocator,
  resolvePlacedFilesystemWriteRoot,
} from "../workspace-resolver/write-roots.js";
import {
  buildWorkspaceResourceId,
  createMemoryWorkspaceCatalog,
  createWorkspaceBinding,
  createWorkspaceResourceResolver,
  type ConstrainedWorkspaceHandle,
  type WorkspaceResolveOperation,
} from "./resource-resolver.js";
import type { WorkspaceOwnerScope, WorkspaceResourceRecord } from "./types.js";
import {
  DEFAULT_TOOL_WRITE_CHANNELS,
  PRIMARY_CAPABLE_WRITE_CHANNELS,
  resolveDeclaredWriteChannel,
  type WorkspaceWriteChannel,
} from "./write-channel.js";

const logTrustedAgentLocator = createSubsystemLogger("gateway/workspace/trusted-agent-locator");

export type AuthorizedWorkspaceAccess = {
  handle: ConstrainedWorkspaceHandle;
  ownerScope: WorkspaceOwnerScope;
  baseReal: string;
  audit: {
    resourceId: string;
    denyReason: string | null;
    cacheHit: boolean;
  };
};

export type WorkspaceAccessDenial = {
  ok: false;
  code:
    | "missing_user"
    | "missing_tenant"
    | "unknown_ownership"
    | "not_authorized"
    | "shared_root_denied"
    | "path_escape"
    | "resolver_denied"
    | "workspace_missing"
    | "write_channel_denied"
    | "governance_unavailable";
  message: string;
};

export type WorkspaceAccessSuccess = {
  ok: true;
  access: AuthorizedWorkspaceAccess;
  absoluteFilePath: string;
};

const processCatalog = createMemoryWorkspaceCatalog();
/** Last-known process snapshot for personal_local degraded reads when live catalog path fails. */
let lastGoodProcessSnapshot: Awaited<ReturnType<typeof processCatalog.getSnapshot>> = null;

const processResolver = createWorkspaceResourceResolver({
  catalog: {
    currentEpoch: () => processCatalog.currentEpoch(),
    bumpEpoch: (resourceId: string) => processCatalog.bumpEpoch(resourceId),
    async getSnapshot() {
      try {
        // Soft refresh durable cache epoch alignment (non-blocking for projection).
        const durable = getSharedDataGovernanceCatalog();
        void durable.currentEpoch();
        const snap = await processCatalog.getSnapshot();
        if (snap) {
          lastGoodProcessSnapshot = snap;
        }
        return snap;
      } catch {
        return null;
      }
    },
    async getDegradedSnapshot() {
      // personal_local read-only fallback — never used for managed writes (resolver enforces).
      return lastGoodProcessSnapshot;
    },
  },
  managedFailClosed: true,
});

/** Shared host roots are never implicit workspace candidates (C1/C7). */
const DENIED_SHARED_ROOT_SEGMENTS = new Set(["canvas", "skills"]);

export function isDeniedSharedHostRoot(absolutePath: string): boolean {
  const segments = path.resolve(absolutePath).split(path.sep).filter(Boolean);
  return !isPerUserTenantTree(segments) && segments.some((s) => DENIED_SHARED_ROOT_SEGMENTS.has(s));
}

export function normalizeRelativeWorkspacePath(requested: string): string | null {
  const normalized = requested.trim().replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.length > 500 ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.includes("\0") ||
    /^[a-z]:\//i.test(normalized)
  ) {
    return null;
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes(":"),
    )
  ) {
    return null;
  }
  return segments.join("/");
}

function isWithinDir(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function ensureCatalogResource(params: {
  tenantId: string | null;
  ownerScope: WorkspaceOwnerScope;
  locator: string;
  classification: string;
  /** Managed writes fail closed when durable governance catalog cannot be updated. */
  failClosed: boolean;
}): Promise<{ ok: true; resourceId: string } | { ok: false; message: string }> {
  const resourceId = buildWorkspaceResourceId({
    tenantId: params.tenantId,
    ownerScope: params.ownerScope,
  });
  // Never path.resolve URI / unplaced catalog locators — that creates cwd-relative
  // `unplaced:/classified/...` directories. Keep opaque locators as-is for Catalog metadata.
  const locatorReal = isFilesystemWorkspaceLocator(params.locator)
    ? path.resolve(params.locator)
    : params.locator.trim();

  // Durable Catalog is the sole governance authority for lifecycle/bindings.
  if (params.ownerScope.kind !== "unknown") {
    try {
      const durable = getSharedDataGovernanceCatalog();
      let record = await durable.get(resourceId);
      if (!record) {
        // First registration only — never used to reactivate existing rows.
        record = await upsertWorkspaceGovernanceRecord({
          resourceId,
          tenantId: params.tenantId,
          ownerScope: params.ownerScope,
          locator: locatorReal,
          classification: params.classification,
        });
      } else if (record.envelope.lifecycleState === "active") {
        // Active-only locator refresh; lifecycle untouched.
        record = await upsertWorkspaceGovernanceRecord({
          resourceId,
          tenantId: params.tenantId,
          ownerScope: params.ownerScope,
          locator: locatorReal,
          classification: params.classification,
        });
      }
      await durable.captureSnapshot().catch(() => undefined);

      // Process projection MUST be built from durable record (not classifier “active”).
      const projected = projectDurableWorkspaceToResolver({
        record,
        fallbackOwnerScope: params.ownerScope,
      });
      processCatalog.upsert(projected.resource, projected.bindings);
      lastGoodProcessSnapshot = await processCatalog.getSnapshot();
      return { ok: true, resourceId };
    } catch (err) {
      if (params.failClosed) {
        return {
          ok: false,
          message: `governance catalog unavailable: ${String((err as Error)?.message ?? err)}`,
        };
      }
      // Personal Local without durable: fall through to ephemeral projection below.
    }
  }

  // Ephemeral-only path (unknown ownership or durable unavailable in personal mode).
  // Still must not invent active over a durable non-active row — durable was unavailable.
  const snapshot = await processCatalog.getSnapshot();
  const existing = snapshot?.resources.get(resourceId);
  if (existing) {
    lastGoodProcessSnapshot = snapshot;
    return { ok: true, resourceId };
  }
  const resource: WorkspaceResourceRecord = {
    resourceId,
    resourceType: "workspace",
    tenantId: params.tenantId,
    ownerScope: params.ownerScope,
    lifecycleState: "active",
    classification: params.classification,
    governanceVersion: 1,
  };
  processCatalog.upsert(resource, [
    createWorkspaceBinding({
      resourceId,
      locator: locatorReal,
      role: "canonical",
      state: "active",
    }),
  ]);
  lastGoodProcessSnapshot = await processCatalog.getSnapshot();
  return { ok: true, resourceId };
}

export async function authorizeAgentWorkspaceFileAccess(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  userId: string;
  agentId: string;
  relativePath: string;
  operation: WorkspaceResolveOperation;
  purpose: string;
  /**
   * Locator chosen by an existing trusted adapter (tenant-context / steward isolation).
   * Must not be built from client path segments.
   */
  locator: string;
  /** Steward / employee_private system exception. */
  stewardException?: boolean;
  /**
   * C17 write-channel capabilities. Defaults to interaction-only for tool writes.
   * Workbench/promote paths should pass PRIMARY_CAPABLE_WRITE_CHANNELS.
   */
  allowedWriteChannels?: readonly WorkspaceWriteChannel[];
}): Promise<WorkspaceAccessSuccess | WorkspaceAccessDenial> {
  const relativePath = normalizeRelativeWorkspacePath(params.relativePath);
  if (!relativePath) {
    return { ok: false, code: "path_escape", message: "invalid filename" };
  }
  if (isDeniedSharedHostRoot(params.locator)) {
    return {
      ok: false,
      code: "shared_root_denied",
      message: "shared host roots require an explicit grant and are not workspace candidates",
    };
  }

  if (params.operation === "write") {
    const channels = params.allowedWriteChannels ?? DEFAULT_TOOL_WRITE_CHANNELS;
    const channelGate = resolveDeclaredWriteChannel({
      relativePath,
      allowedChannels: channels,
    });
    if (!channelGate.ok) {
      return { ok: false, code: "write_channel_denied", message: channelGate.reason };
    }
  }

  const profile = resolveSecurityProfile(params.cfg, process.env);
  let tenantCtx: TenantContext | null = null;
  if (isSharedTenantAddressingEnabled(params.cfg) || profile.profile === "managed_enterprise") {
    tenantCtx = await resolveTenantContextForSessionStore(params.client);
    if (profile.profile === "managed_enterprise" && !tenantCtx?.tenantId) {
      return { ok: false, code: "missing_tenant", message: "trusted tenant context required" };
    }
  }

  let ownerScope: WorkspaceOwnerScope;
  if (params.stewardException) {
    ownerScope = {
      kind: "user_owned",
      userId: params.userId,
      agentAssetId: "steward:main",
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: params.userId,
        agentAssetId: "steward:main",
      },
    };
  } else {
    const registry = await loadAgentRegistryStore();
    ownerScope = classifyWorkspaceOwnership({
      actor: {
        tenantId: tenantCtx?.tenantId ?? "local",
        userId: params.userId,
      },
      registry,
      agentId: params.agentId,
      clientOwnerHint: null,
      clientTenantHint: null,
    });
  }

  if (params.operation === "write" && !isWritableWorkspaceScope(ownerScope)) {
    return { ok: false, code: "unknown_ownership", message: "unknown ownership blocks writes" };
  }
  if (
    profile.profile === "managed_enterprise" &&
    !isWritableWorkspaceScope(ownerScope) &&
    !params.stewardException
  ) {
    return {
      ok: false,
      code: "unknown_ownership",
      message: `ownership classification failed: ${ownerScope.kind === "unknown" ? ownerScope.reason : "unknown"}`,
    };
  }

  const catalogued = await ensureCatalogResource({
    tenantId: tenantCtx?.tenantId ?? null,
    ownerScope,
    locator: params.locator,
    classification: params.stewardException ? "employee_private" : "agent_workspace",
    failClosed: params.operation === "write" && profile.profile === "managed_enterprise",
  });
  if (!catalogued.ok) {
    return { ok: false, code: "governance_unavailable", message: catalogued.message };
  }
  const resourceId = catalogued.resourceId;

  const resolved = await processResolver.resolve({
    actor: {
      tenantId: tenantCtx?.tenantId ?? null,
      principalId: params.userId,
      profile: profile.profile,
    },
    resourceId,
    operation: params.operation,
    purpose: params.purpose,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      code: "resolver_denied",
      message: `workspace resolve denied: ${resolved.denyReason}`,
    };
  }

  let baseReal: string;
  try {
    baseReal = fs.realpathSync(resolved.handle._locator);
  } catch {
    return { ok: false, code: "workspace_missing", message: "workspace file not found" };
  }

  const target = path.join(baseReal, relativePath);
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    // For read of missing file, still report not found (not path escape).
    if (params.operation === "write") {
      // Allow write into non-existent leaf if parent stays inside base.
      const parent = path.dirname(target);
      try {
        const parentReal = fs.realpathSync(parent);
        if (
          !isWithinDir(baseReal, path.join(parentReal, path.basename(target))) &&
          parentReal !== baseReal &&
          !isWithinDir(baseReal, parentReal)
        ) {
          return { ok: false, code: "path_escape", message: "invalid filename" };
        }
        real = target;
      } catch {
        return { ok: false, code: "workspace_missing", message: "workspace file not found" };
      }
    } else {
      return { ok: false, code: "workspace_missing", message: "workspace file not found" };
    }
  }
  if (real !== target && !isWithinDir(baseReal, real)) {
    return { ok: false, code: "path_escape", message: "invalid filename" };
  }
  if (fs.existsSync(real) && !isWithinDir(baseReal, fs.realpathSync(real))) {
    return { ok: false, code: "path_escape", message: "invalid filename" };
  }

  return {
    ok: true,
    access: {
      handle: resolved.handle,
      ownerScope,
      baseReal,
      audit: {
        resourceId,
        denyReason: null,
        cacheHit: resolved.audit.cacheHit,
      },
    },
    absoluteFilePath: real,
  };
}

export async function authorizeGroupWorkspaceFileAccess(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  userId: string;
  groupId: string;
  relativePath: string;
  operation: WorkspaceResolveOperation;
  purpose: string;
  locator: string;
  groupAclVerified: boolean;
  /** Authoritative tenant id already resolved by the handler (never a client hint). */
  authoritativeTenantId?: string | null;
  /**
   * C17 write-channel capabilities. Defaults to interaction-only for tool writes.
   * Workbench/primary deliverable paths should pass PRIMARY_CAPABLE_WRITE_CHANNELS.
   */
  allowedWriteChannels?: readonly WorkspaceWriteChannel[];
}): Promise<WorkspaceAccessSuccess | WorkspaceAccessDenial> {
  const relativePath = normalizeRelativeWorkspacePath(params.relativePath);
  if (!relativePath) {
    return { ok: false, code: "path_escape", message: "invalid filename" };
  }
  if (!params.groupAclVerified) {
    return {
      ok: false,
      code: "not_authorized",
      message: "not authorized to read group workspace file",
    };
  }
  if (isDeniedSharedHostRoot(params.locator)) {
    return {
      ok: false,
      code: "shared_root_denied",
      message: "shared host roots require an explicit grant and are not workspace candidates",
    };
  }

  if (params.operation === "write") {
    const channels = params.allowedWriteChannels ?? DEFAULT_TOOL_WRITE_CHANNELS;
    const channelGate = resolveDeclaredWriteChannel({
      relativePath,
      allowedChannels: channels,
    });
    if (!channelGate.ok) {
      return { ok: false, code: "write_channel_denied", message: channelGate.reason };
    }
  }

  const profile = resolveSecurityProfile(params.cfg, process.env);
  let tenantId =
    typeof params.authoritativeTenantId === "string" && params.authoritativeTenantId.trim()
      ? params.authoritativeTenantId.trim()
      : null;
  if (
    !tenantId &&
    (isSharedTenantAddressingEnabled(params.cfg) || profile.profile === "managed_enterprise")
  ) {
    const tenantCtx = await resolveTenantContextForSessionStore(params.client);
    tenantId = tenantCtx?.tenantId ?? null;
  }
  if (profile.profile === "managed_enterprise" && !tenantId) {
    return { ok: false, code: "missing_tenant", message: "trusted tenant context required" };
  }

  const ownerScope = classifyWorkspaceOwnership({
    actor: {
      tenantId: tenantId ?? "local",
      userId: params.userId,
    },
    registry: null,
    groupId: params.groupId,
    groupAclVerified: params.groupAclVerified,
  });
  if (ownerScope.kind !== "group_owned") {
    return {
      ok: false,
      code: "unknown_ownership",
      message: "group ownership classification failed",
    };
  }

  const catalogued = await ensureCatalogResource({
    tenantId,
    ownerScope,
    locator: params.locator,
    classification: "group_workspace",
    failClosed: params.operation === "write" && profile.profile === "managed_enterprise",
  });
  if (!catalogued.ok) {
    return { ok: false, code: "governance_unavailable", message: catalogued.message };
  }
  const resourceId = catalogued.resourceId;

  const resolved = await processResolver.resolve({
    actor: {
      tenantId,
      principalId: params.userId,
      profile: profile.profile,
    },
    resourceId,
    operation: params.operation,
    purpose: params.purpose,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      code: "resolver_denied",
      message: `workspace resolve denied: ${resolved.denyReason}`,
    };
  }

  let baseReal: string;
  try {
    if (!isFilesystemWorkspaceLocator(resolved.handle._locator)) {
      throw new Error("unplaced_locator");
    }
    baseReal = fs.realpathSync(resolved.handle._locator);
  } catch {
    if (params.operation === "write") {
      // Group writes still require a real filesystem locator; never mkdir unplaced://.
      if (!isFilesystemWorkspaceLocator(params.locator)) {
        return { ok: false, code: "workspace_missing", message: "group file not found" };
      }
      try {
        fs.mkdirSync(path.resolve(params.locator), { recursive: true });
        baseReal = fs.realpathSync(path.resolve(params.locator));
      } catch {
        return { ok: false, code: "workspace_missing", message: "group file not found" };
      }
    } else {
      return { ok: false, code: "workspace_missing", message: "group file not found" };
    }
  }
  const target = path.join(baseReal, relativePath);
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    if (params.operation === "write") {
      const parent = path.dirname(target);
      try {
        fs.mkdirSync(parent, { recursive: true });
        const parentReal = fs.realpathSync(parent);
        if (parentReal !== baseReal && !isWithinDir(baseReal, parentReal)) {
          return { ok: false, code: "path_escape", message: "invalid filename" };
        }
        real = target;
      } catch {
        return { ok: false, code: "workspace_missing", message: "group file not found" };
      }
    } else {
      return { ok: false, code: "workspace_missing", message: "group file not found" };
    }
  }
  if (fs.existsSync(real) && !isWithinDir(baseReal, fs.realpathSync(real))) {
    return { ok: false, code: "path_escape", message: "invalid filename" };
  }
  if (real !== target && !isWithinDir(baseReal, real)) {
    return { ok: false, code: "path_escape", message: "invalid filename" };
  }

  return {
    ok: true,
    access: {
      handle: resolved.handle,
      ownerScope,
      baseReal,
      audit: {
        resourceId,
        denyReason: null,
        cacheHit: resolved.audit.cacheHit,
      },
    },
    absoluteFilePath: real,
  };
}

/**
 * Resolve agent locator through the trusted Item 7 Handle (S29).
 * Builds a complete WorkspaceLocatorQueryAttempt from client + catalog
 * (same builder as agents.* handlers). Never cfg-only; managed stays fail-closed.
 */
export async function resolveTrustedAgentLocator(params: {
  client: GatewayClient | null;
  agentId: string;
  cfg: OpenBotConfig;
  /** Personal workbench session key, used only to restore a missing actor. */
  sessionKey?: string | null;
}): Promise<string> {
  const located = await resolveAgentsHandlerWorkspaceLocator({
    client: params.client,
    cfg: params.cfg,
    agentId: params.agentId,
    purpose: "trusted.agent.locator",
    sessionKey: params.sessionKey,
  });
  if (!located.ok) {
    logTrustedAgentLocator.warn(
      `S29 trusted agent locator denied reasonCode=${located.reasonCode} agentId=${params.agentId}`,
    );
    throw new Error(located.reasonCode);
  }
  void import("../gateway-w2-shadow.js").then((m) =>
    m.scheduleGatewayW2ResolvedShadow({
      siteId: "S29-trusted-agent-locator",
      resolvedLocator: located.handle.locator,
    }),
  );
  return located.handle.locator;
}

export { resolveTrustedGroupLocator };

/**
 * Authorize the workspace root used as tool cwd / chat write channel base (C17).
 * Does not open a file; proves the locator is classifiable and resolver-approved.
 */
export async function authorizeWorkspaceRootAccess(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  userId: string;
  agentId: string;
  purpose: string;
  locator: string;
  operation?: "list" | "read" | "write";
  stewardException?: boolean;
}): Promise<{ ok: true; access: AuthorizedWorkspaceAccess } | WorkspaceAccessDenial> {
  const marker = ".workspace-access-marker";
  // Ensure a relative path exists for containment; create marker only in memory check path.
  // Prefer list authorization against an existing marker or the root listing via a synthetic read
  // of a well-known relative name that may be missing (list/root).
  const profile = resolveSecurityProfile(params.cfg, process.env);
  if (isDeniedSharedHostRoot(params.locator)) {
    return {
      ok: false,
      code: "shared_root_denied",
      message: "shared host roots require an explicit grant and are not workspace candidates",
    };
  }

  let tenantCtx: TenantContext | null = null;
  if (isSharedTenantAddressingEnabled(params.cfg) || profile.profile === "managed_enterprise") {
    tenantCtx = await resolveTenantContextForSessionStore(params.client);
    if (profile.profile === "managed_enterprise" && !tenantCtx?.tenantId) {
      return { ok: false, code: "missing_tenant", message: "trusted tenant context required" };
    }
  }

  let ownerScope: WorkspaceOwnerScope;
  if (params.stewardException) {
    ownerScope = {
      kind: "user_owned",
      userId: params.userId,
      agentAssetId: "steward:main",
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: params.userId,
        agentAssetId: "steward:main",
      },
    };
  } else {
    const registry = await loadAgentRegistryStore();
    ownerScope = classifyWorkspaceOwnership({
      actor: {
        tenantId: tenantCtx?.tenantId ?? "local",
        userId: params.userId,
      },
      registry,
      agentId: params.agentId,
      clientOwnerHint: null,
      clientTenantHint: null,
    });
  }

  const operation = params.operation ?? "list";
  if (operation === "write" && !isWritableWorkspaceScope(ownerScope)) {
    return { ok: false, code: "unknown_ownership", message: "unknown ownership blocks writes" };
  }
  if (
    profile.profile === "managed_enterprise" &&
    !isWritableWorkspaceScope(ownerScope) &&
    !params.stewardException
  ) {
    return {
      ok: false,
      code: "unknown_ownership",
      message: `ownership classification failed: ${ownerScope.kind === "unknown" ? ownerScope.reason : "unknown"}`,
    };
  }

  const catalogued = await ensureCatalogResource({
    tenantId: tenantCtx?.tenantId ?? null,
    ownerScope,
    locator: params.locator,
    classification: params.stewardException ? "employee_private" : "agent_workspace",
    failClosed: operation === "write" && profile.profile === "managed_enterprise",
  });
  if (!catalogued.ok) {
    return { ok: false, code: "governance_unavailable", message: catalogued.message };
  }
  const resourceId = catalogued.resourceId;

  const resolved = await processResolver.resolve({
    actor: {
      tenantId: tenantCtx?.tenantId ?? null,
      principalId: params.userId,
      profile: profile.profile,
    },
    resourceId,
    operation,
    purpose: params.purpose,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      code: "resolver_denied",
      message: `workspace resolve denied: ${resolved.denyReason}`,
    };
  }

  let baseReal: string;
  try {
    if (!isFilesystemWorkspaceLocator(resolved.handle._locator)) {
      throw new Error("unplaced_locator");
    }
    baseReal = fs.realpathSync(resolved.handle._locator);
  } catch {
    const placed = resolvePlacedFilesystemWriteRoot({
      locator: params.locator,
      agentId: params.agentId,
      tenantId: tenantCtx?.tenantId ?? null,
      userId: params.userId,
      ensureDirectory: true,
    });
    if (!placed) {
      return { ok: false, code: "workspace_missing", message: "workspace file not found" };
    }
    try {
      baseReal = fs.realpathSync(placed);
    } catch {
      return { ok: false, code: "workspace_missing", message: "workspace file not found" };
    }
  }
  if (isDeniedSharedHostRoot(baseReal)) {
    return {
      ok: false,
      code: "shared_root_denied",
      message: "shared host roots require an explicit grant and are not workspace candidates",
    };
  }

  // Touch marker path only for auditability of root authorization (not written).
  void marker;

  return {
    ok: true,
    access: {
      handle: resolved.handle,
      ownerScope,
      baseReal,
      audit: {
        resourceId,
        denyReason: null,
        cacheHit: resolved.audit.cacheHit,
      },
    },
  };
}

/**
 * Authorize a group workspace root for tool cwd (membership + catalog + resolver).
 * Agent workspace authorization must not substitute for this gate.
 */
export async function authorizeGroupWorkspaceRootAccess(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  userId: string;
  groupId: string;
  purpose: string;
  locator: string;
  groupAclVerified: boolean;
  authoritativeTenantId?: string | null;
}): Promise<{ ok: true; access: AuthorizedWorkspaceAccess } | WorkspaceAccessDenial> {
  if (!params.groupAclVerified) {
    return {
      ok: false,
      code: "not_authorized",
      message: "not authorized to access group workspace",
    };
  }
  if (isDeniedSharedHostRoot(params.locator)) {
    return {
      ok: false,
      code: "shared_root_denied",
      message: "shared host roots require an explicit grant and are not workspace candidates",
    };
  }

  const profile = resolveSecurityProfile(params.cfg, process.env);
  let tenantId =
    typeof params.authoritativeTenantId === "string" && params.authoritativeTenantId.trim()
      ? params.authoritativeTenantId.trim()
      : null;
  if (
    !tenantId &&
    (isSharedTenantAddressingEnabled(params.cfg) || profile.profile === "managed_enterprise")
  ) {
    const tenantCtx = await resolveTenantContextForSessionStore(params.client);
    tenantId = tenantCtx?.tenantId ?? null;
  }
  if (profile.profile === "managed_enterprise" && !tenantId) {
    return { ok: false, code: "missing_tenant", message: "trusted tenant context required" };
  }

  const ownerScope = classifyWorkspaceOwnership({
    actor: {
      tenantId: tenantId ?? "local",
      userId: params.userId,
    },
    registry: null,
    groupId: params.groupId,
    groupAclVerified: params.groupAclVerified,
  });
  if (ownerScope.kind !== "group_owned") {
    return {
      ok: false,
      code: "unknown_ownership",
      message: "group ownership classification failed",
    };
  }

  const catalogued = await ensureCatalogResource({
    tenantId,
    ownerScope,
    locator: params.locator,
    classification: "group_workspace",
    failClosed: false,
  });
  if (!catalogued.ok) {
    return { ok: false, code: "governance_unavailable", message: catalogued.message };
  }
  const resourceId = catalogued.resourceId;

  const resolved = await processResolver.resolve({
    actor: {
      tenantId,
      principalId: params.userId,
      profile: profile.profile,
    },
    resourceId,
    operation: "list",
    purpose: params.purpose,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      code: "resolver_denied",
      message: `workspace resolve denied: ${resolved.denyReason}`,
    };
  }

  let baseReal: string;
  try {
    if (!isFilesystemWorkspaceLocator(resolved.handle._locator)) {
      throw new Error("unplaced_locator");
    }
    baseReal = fs.realpathSync(resolved.handle._locator);
  } catch {
    if (!isFilesystemWorkspaceLocator(params.locator)) {
      return { ok: false, code: "workspace_missing", message: "group workspace not found" };
    }
    try {
      fs.mkdirSync(path.resolve(params.locator), { recursive: true });
      baseReal = fs.realpathSync(path.resolve(params.locator));
    } catch {
      return { ok: false, code: "workspace_missing", message: "group workspace not found" };
    }
  }
  if (isDeniedSharedHostRoot(baseReal)) {
    return {
      ok: false,
      code: "shared_root_denied",
      message: "shared host roots require an explicit grant and are not workspace candidates",
    };
  }

  return {
    ok: true,
    access: {
      handle: resolved.handle,
      ownerScope,
      baseReal,
      audit: {
        resourceId,
        denyReason: null,
        cacheHit: resolved.audit.cacheHit,
      },
    },
  };
}

/**
 * After Resolver authorization: Managed Enterprise never falls back to legacy paths.
 * Personal Local may use an explicit personal fallback.
 */
export function resolveWorkspaceDirAfterAuthorization(params: {
  profile: "personal_local" | "managed_enterprise";
  authorizedCwd: string | null | undefined;
  personalFallback?: () => string | null;
}): string | null {
  const authorized =
    typeof params.authorizedCwd === "string" && params.authorizedCwd.trim()
      ? params.authorizedCwd.trim()
      : null;
  if (authorized) {
    return authorized;
  }
  if (params.profile === "managed_enterprise") {
    return null;
  }
  return params.personalFallback?.() ?? null;
}

export type AuthorizedToolCwdResolution = {
  cwd: string | null;
  /** Present when cwd is null because the trusted locator or root gate denied. */
  reasonCode?: string;
};

/**
 * Resolve tool/chat cwd through trusted locator + ownership/resolver gate (C17).
 * `reasonCode` is the underlying denial (S29 auth_failure, seat_agent_unbound, …).
 */
export async function resolveAuthorizedToolCwdDetailed(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  userId: string | null | undefined;
  agentId: string;
  purpose?: string;
  stewardException?: boolean;
  /**
   * Employee steward helper cwd (shadow-only). When set with stewardException,
   * this path is never the authorizeWorkspaceRootAccess locator and never
   * user-visible managed cwd. Missing value fail-closes; this function does
   * not invoke the legacy helper.
   */
  stewardWorkspaceDir?: string | null;
  /** Optional group overlay after agent primary is authorized. */
  groupId?: string | null;
  authoritativeTenantId?: string | null;
  /** Personal session key for actor restore. Not a grant. */
  sessionKey?: string | null;
}): Promise<AuthorizedToolCwdResolution> {
  if (!params.userId?.trim()) {
    return { cwd: null, reasonCode: "missing_actor" };
  }
  let locator: string;
  if (params.stewardException) {
    // Helper is shadow-only (comparison / telemetry). It is never the
    // authorizeWorkspaceRootAccess locator and never user-visible managed cwd.
    // Missing stewardWorkspaceDir fail-closes; do not invoke the helper here.
    // Managed path is decided by resolveTrustedAgentLocator (Handle).
    const helper =
      typeof params.stewardWorkspaceDir === "string" && params.stewardWorkspaceDir.trim()
        ? path.resolve(params.stewardWorkspaceDir.trim())
        : null;
    if (!helper) {
      return { cwd: null, reasonCode: "missing_steward_workspace" };
    }
  }
  try {
    locator = await resolveTrustedAgentLocator({
      client: params.client,
      agentId: params.agentId,
      cfg: params.cfg,
      sessionKey: params.sessionKey,
    });
  } catch (err) {
    let reasonCode = err instanceof Error && err.message ? err.message : "locator_rejected";
    if (
      reasonCode === "actor_optional_forbidden" &&
      personalWorkbenchSessionNeedsActor({
        client: params.client,
        sessionKey: params.sessionKey,
      })
    ) {
      reasonCode = "personal_workbench_actor_unrestored";
    }
    logTrustedAgentLocator.warn(
      `resolveAuthorizedToolCwd locator rejected reasonCode=${reasonCode} agentId=${params.agentId} steward=${Boolean(params.stewardException)}`,
    );
    return { cwd: null, reasonCode };
  }

  const root = await authorizeWorkspaceRootAccess({
    client: params.client,
    cfg: params.cfg,
    userId: params.userId.trim(),
    agentId: params.agentId,
    purpose: params.purpose ?? "tool.cwd",
    locator,
    operation: "list",
    stewardException: params.stewardException,
  });
  if (!root.ok) {
    return { cwd: null, reasonCode: root.code };
  }

  const groupId = params.groupId?.trim();
  if (!groupId) {
    return { cwd: root.access.baseReal };
  }

  const groupCwd = await resolveAuthorizedGroupToolCwd({
    client: params.client,
    cfg: params.cfg,
    userId: params.userId.trim(),
    groupId,
    purpose: params.purpose,
    authoritativeTenantId: params.authoritativeTenantId,
  });
  if (!groupCwd) {
    return { cwd: null, reasonCode: "group_workspace_unauthorized" };
  }
  return { cwd: groupCwd };
}

/** String cwd used by transcript and checkpoint callers. Denial reason is dropped. */
export async function resolveAuthorizedToolCwd(
  params: Parameters<typeof resolveAuthorizedToolCwdDetailed>[0],
): Promise<string | null> {
  return (await resolveAuthorizedToolCwdDetailed(params)).cwd;
}

/**
 * Authorize the collaboration-group workspace from a frozen ChatTurn tenant.
 * Used when the executing sessionKey is a bot 1:1 key, not `space:<groupId>`.
 */
export async function resolveAuthorizedGroupToolCwd(params: {
  client: GatewayClient | null;
  cfg: OpenBotConfig;
  userId: string;
  groupId: string;
  purpose?: string;
  authoritativeTenantId?: string | null;
}): Promise<string | null> {
  const groupId = params.groupId.trim();
  const userId = params.userId.trim();
  if (!groupId || !userId) {
    return null;
  }
  const profile = resolveSecurityProfile(params.cfg, process.env);
  let tenantId = params.authoritativeTenantId?.trim() ?? null;
  if (
    !tenantId &&
    (isSharedTenantAddressingEnabled(params.cfg) || profile.profile === "managed_enterprise")
  ) {
    const tenantCtx = await resolveTenantContextForSessionStore(params.client);
    tenantId = tenantCtx?.tenantId ?? null;
  }
  if (profile.profile === "managed_enterprise" && !tenantId) {
    return null;
  }

  const aclDenied = await assertGroupMemberAccess({
    groupId,
    userId,
    tenantId,
    profile: profile.profile,
    cfg: params.cfg,
    identityAliases: [params.client?.user ?? ""].map((entry) => entry.trim()).filter(Boolean),
  });
  if (aclDenied) {
    return null;
  }

  let groupLocator: string;
  try {
    groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: profile.profile,
      cfg: params.cfg,
    });
  } catch {
    return null;
  }

  const groupRoot = await authorizeGroupWorkspaceRootAccess({
    client: params.client,
    cfg: params.cfg,
    userId,
    groupId,
    purpose: params.purpose ?? "tool.cwd.group",
    locator: groupLocator,
    groupAclVerified: true,
    authoritativeTenantId: tenantId,
  });
  if (!groupRoot.ok) {
    return null;
  }
  return groupRoot.access.baseReal;
}

function isPerUserTenantTree(segments: string[]): boolean {
  const usersIdx = segments.lastIndexOf("users");
  if (usersIdx < 2 || usersIdx + 1 >= segments.length) {
    return false;
  }
  const owner = segments[usersIdx + 1];
  if (!owner || DENIED_SHARED_ROOT_SEGMENTS.has(owner)) {
    return false;
  }
  const container = segments[usersIdx - 2];
  return container === "tenants" || container === "openbot-tenants";
}

export { DEFAULT_TOOL_WRITE_CHANNELS, PRIMARY_CAPABLE_WRITE_CHANNELS, type WorkspaceWriteChannel };
