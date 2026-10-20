/**
 * Shared operator object-level access + authenticated principal derivation.
 *
 * Method-scope (operator.approvals) is NOT tenant authorization.
 * Authorization compares three authorities when a client is present:
 *   1. membership tenant (platform-auth email → user → membership → enterpriseId)
 *   2. agent ownership tenants (cfg.agents.list + agent-runtime tenantCoverage)
 *   3. optional resource tenantId (e.g. pattern candidate.tenantId)
 *
 * Directory resolution (resolveAgentDirForClient) is storage location only — never used as ACL.
 */

import { listAgentIds } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { getAgent } from "../agent-runtime-store.js";
import { resolveAgentTenant } from "../agent-tenant.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { canonicalizeTenantId, canonicalizeTenantIdList } from "../tenant-canonicalization.js";
import { resolveAuthoritativeMembership } from "../tenant-context.js";
import type { GatewayClient, RespondFn } from "./types.js";

/**
 * Proven owning tenants for an agent:
 * 1. resolveAgentTenant (cfg.agents.list tenantId / owner membership)
 * 2. agent-runtime-store tenantCoverage
 * Empty → no ownership proof (fail closed for authenticated clients).
 */
export async function resolveAgentOwnershipTenants(agentId: string): Promise<string[]> {
  const owned = new Set<string>();
  try {
    const fromConfig = await resolveAgentTenant(agentId);
    if (fromConfig) {
      owned.add(fromConfig);
    }
  } catch {
    // ignore
  }
  try {
    const runtime = getAgent(agentId);
    if (runtime?.tenantCoverage?.length) {
      for (const t of canonicalizeTenantIdList(runtime.tenantCoverage)) {
        owned.add(t);
      }
    }
  } catch {
    // ignore
  }
  return [...owned];
}

export function assertKnownAgent(agentId: string, respond: RespondFn): string | null {
  const cfg = loadConfig();
  const normalized = normalizeAgentId(agentId);
  if (!listAgentIds(cfg).includes(normalized)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent: ${agentId}`));
    return null;
  }
  return normalized;
}

export type AgentAccessOptions = {
  /**
   * Resource-level tenant id (e.g. candidate.tenantId). When set, must equal
   * the caller's membership tenant. When requireResourceTenant is true, missing
   * resource tenant fails closed.
   */
  resourceTenantId?: string | null;
  /** Fail if resourceTenantId is missing/empty (default false). */
  requireResourceTenant?: boolean;
};

export type AgentAccessOk = {
  agentId: string;
  /** Membership enterprise id (null only for in-process client=null). */
  tenantId: string | null;
  /** Platform-auth user id (null only for in-process client=null). */
  userId: string | null;
};

/**
 * Object-level agent access for authenticated gateway clients.
 *
 * - client=null: in-process / unit-test path (no multi-tenant claim) — allows normalized agent id.
 * - client present: requires authoritative membership + agent ownership intersection;
 *   optional resource tenant must match membership tenant.
 */
export async function assertClientMayAccessAgent(
  client: GatewayClient | null | undefined,
  agentId: string,
  respond: RespondFn,
  options?: AgentAccessOptions,
): Promise<string | null> {
  const access = await assertClientMayAccessAgentDetailed(client, agentId, respond, options);
  return access?.agentId ?? null;
}

/**
 * Same as {@link assertClientMayAccessAgent} but returns membership tenant/user for audit writes.
 */
export async function assertClientMayAccessAgentDetailed(
  client: GatewayClient | null | undefined,
  agentId: string,
  respond: RespondFn,
  options?: AgentAccessOptions,
): Promise<AgentAccessOk | null> {
  const normalized = normalizeAgentId(agentId);
  if (!normalized) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
    return null;
  }

  // In-process callers (scheduler, unit tests without a session): no tenant claim.
  if (!client) {
    return { agentId: normalized, tenantId: null, userId: null };
  }

  let membership: { tenantId: string | null; userId: string | null };
  try {
    membership = await resolveAuthoritativeMembership(client);
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        error instanceof Error ? error.message : "membership resolution failed",
      ),
    );
    return null;
  }

  const membershipTenant = membership.tenantId ? canonicalizeTenantId(membership.tenantId) : null;
  const userId = membership.userId?.trim() || null;
  if (!membershipTenant || !userId) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "tenant membership required for agent-scoped operation",
      ),
    );
    return null;
  }

  const agentTenants = await resolveAgentOwnershipTenants(normalized);
  if (agentTenants.length === 0) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `agent has no tenant ownership proof: ${normalized}`),
    );
    return null;
  }
  if (!agentTenants.includes(membershipTenant)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `agent access denied: ${normalized}`),
    );
    return null;
  }

  const rawResource = options?.resourceTenantId;
  const resourceTenant =
    typeof rawResource === "string" && rawResource.trim()
      ? canonicalizeTenantId(rawResource.trim())
      : null;

  if (options?.requireResourceTenant && !resourceTenant) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "resource tenantId required"));
    return null;
  }
  if (resourceTenant && resourceTenant !== membershipTenant) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "resource tenant mismatch"));
    return null;
  }

  return { agentId: normalized, tenantId: membershipTenant, userId };
}

/**
 * Candidate / job object ACL: agent ownership ∩ membership ∩ candidate.tenantId.
 */
export async function assertClientMayAccessCandidate(
  client: GatewayClient | null | undefined,
  candidate: { agentId: string; tenantId?: string | null },
  respond: RespondFn,
): Promise<AgentAccessOk | null> {
  return assertClientMayAccessAgentDetailed(client, candidate.agentId, respond, {
    resourceTenantId: candidate.tenantId,
    // Candidates created after this fix must carry authority tenantId.
    // Legacy null tenantId is rejected for authenticated clients (fail closed).
    requireResourceTenant: Boolean(client),
  });
}

/**
 * Tenant governance of **global** runtime actions (pause/limit/redirect/resume).
 *
 * These actions mutate agent-wide bindings — not tenant-partitioned state.
 * Therefore a tenant operator may only act when the agent is **uniquely** owned
 * by their membership tenant. Shared multi-tenant agents require operator.admin.
 *
 * Platform admins (operator.admin) are checked **first** and do **not** need
 * enterprise membership matching the target tenant — only that the agent has
 * valid ownership proof (exists with ≥1 ownership tenant).
 */
export async function assertClientMayGovernRuntimeAgent(
  client: GatewayClient | null | undefined,
  runtimeAgentId: string,
  respond: RespondFn,
): Promise<AgentAccessOk | null> {
  const normalized = normalizeAgentId(runtimeAgentId);
  if (!normalized) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
    return null;
  }

  // In-process / tests without a session.
  if (!client) {
    return { agentId: normalized, tenantId: null, userId: null };
  }

  // Platform admin path: no membership∩tenant requirement.
  if (clientHasOperatorAdminScope(client)) {
    const owners = await resolveAgentOwnershipTenants(normalized);
    if (owners.length === 0) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `agent has no tenant ownership proof: ${normalized}`,
        ),
      );
      return null;
    }
    const principal = resolveAuthenticatedOperatorPrincipal(client);
    return {
      agentId: normalized,
      // Admin may span tenants; surface primary ownership for audit, not ACL gate.
      tenantId: owners[0] ?? null,
      userId: principal && principal !== "system" ? principal : null,
    };
  }

  // Tenant operator: membership ∩ ownership, then unique-owner gate for global actions.
  const access = await assertClientMayAccessAgentDetailed(client, normalized, respond);
  if (!access) {
    return null;
  }
  const uniqueOwner =
    access.tenantId != null &&
    (await isRuntimeAgentUniqueOwnerForTenant(access.agentId, access.tenantId));
  if (!uniqueOwner) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "shared-agent-requires-platform-admin"),
    );
    return null;
  }
  return access;
}

/**
 * Redirect requires source and target both governable by the caller's membership tenant.
 * (Runtime action's tenantCoverage intersection alone is not sufficient ACL.)
 */
export async function assertClientMayGovernRedirect(
  client: GatewayClient | null | undefined,
  sourceAgentId: string,
  targetAgentId: string,
  respond: RespondFn,
): Promise<{ source: AgentAccessOk; target: AgentAccessOk } | null> {
  const source = await assertClientMayGovernRuntimeAgent(client, sourceAgentId, respond);
  if (!source) {
    return null;
  }
  const target = await assertClientMayGovernRuntimeAgent(client, targetAgentId, respond);
  if (!target) {
    return null;
  }
  // Authenticated: both must map to the same membership tenant.
  if (client && source.tenantId && target.tenantId && source.tenantId !== target.tenantId) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "redirect-cross-tenant-denied"),
    );
    return null;
  }
  return { source, target };
}

/** True when connect scopes include operator.admin (or in-process client). */
export function clientHasOperatorAdminScope(client: GatewayClient | null | undefined): boolean {
  if (!client) {
    return true;
  }
  const scopes = (client.connect as { scopes?: unknown } | undefined)?.scopes;
  if (!Array.isArray(scopes)) {
    return false;
  }
  return scopes.some((s) => typeof s === "string" && s.trim() === "operator.admin");
}

/**
 * Global governance controls (kill switch, effect window, skill-auto pass)
 * require platform admin — not tenant operator.approvals alone.
 */
export function requirePlatformGovernanceAdmin(
  client: GatewayClient | null | undefined,
  respond: RespondFn,
): boolean {
  if (clientHasOperatorAdminScope(client)) {
    return true;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, "platform admin required for global governance control"),
  );
  return false;
}

/**
 * Resolve caller's membership tenant for read filtering.
 * - client=null → null (in-process sees all; caller decides)
 * - platform admin → null means "unfiltered" when preferFullAccess
 * - tenant membership → tenantId string
 */
export async function resolveCallerGovernanceTenant(
  client: GatewayClient | null | undefined,
  opts?: { platformAdminSeesAll?: boolean },
): Promise<{ tenantId: string | null; isPlatformAdmin: boolean; userId: string | null }> {
  if (!client) {
    return { tenantId: null, isPlatformAdmin: true, userId: null };
  }
  const isPlatformAdmin = clientHasOperatorAdminScope(client);
  if (isPlatformAdmin && opts?.platformAdminSeesAll !== false) {
    return { tenantId: null, isPlatformAdmin: true, userId: null };
  }
  try {
    const membership = await resolveAuthoritativeMembership(client);
    const tenantId = membership.tenantId ? canonicalizeTenantId(membership.tenantId) : null;
    return {
      tenantId,
      isPlatformAdmin,
      userId: membership.userId?.trim() || null,
    };
  } catch {
    return { tenantId: null, isPlatformAdmin, userId: null };
  }
}

/** Whether a runtime agent is visible under membership tenant (shared agents included). */
export async function isRuntimeAgentInTenant(
  runtimeAgentId: string,
  tenantId: string,
): Promise<boolean> {
  const owners = await resolveAgentOwnershipTenants(runtimeAgentId);
  return owners.includes(tenantId);
}

/**
 * True when the agent is owned by exactly one tenant and that tenant is `tenantId`.
 * Global write actions (limit/pause/redirect) require this for non-admin operators.
 */
export async function isRuntimeAgentUniqueOwnerForTenant(
  runtimeAgentId: string,
  tenantId: string,
): Promise<boolean> {
  const owners = await resolveAgentOwnershipTenants(runtimeAgentId);
  return owners.length === 1 && owners[0] === tenantId;
}

/**
 * Derive audit principal strictly from authenticated connection context.
 * Client-supplied approvedBy / enrolledBy / cancelledBy MUST NOT be used.
 */
export function resolveAuthenticatedOperatorPrincipal(
  client: GatewayClient | null | undefined,
): string | null {
  if (!client) {
    return "system";
  }
  if (typeof client.user === "string" && client.user.trim()) {
    return client.user.trim();
  }
  const connect = client.connect as {
    deviceId?: string;
    clientId?: string;
    auth?: { user?: string; deviceId?: string };
  } | null;
  const authUser =
    typeof connect?.auth?.user === "string" && connect.auth.user.trim()
      ? connect.auth.user.trim()
      : null;
  if (authUser) {
    return authUser;
  }
  const deviceId =
    (typeof connect?.deviceId === "string" && connect.deviceId.trim()) ||
    (typeof connect?.auth?.deviceId === "string" && connect.auth.deviceId.trim()) ||
    null;
  if (deviceId) {
    return `device:${deviceId}`;
  }
  const clientId = typeof connect?.clientId === "string" && connect.clientId.trim();
  if (clientId) {
    return `client:${clientId}`;
  }
  if (typeof client.connId === "string" && client.connId.trim()) {
    return `conn:${client.connId.trim()}`;
  }
  return null;
}

export function requireAuthenticatedOperatorPrincipal(
  client: GatewayClient | null | undefined,
  respond: RespondFn,
): string | null {
  const principal = resolveAuthenticatedOperatorPrincipal(client);
  if (!principal) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "authenticated operator principal required"),
    );
    return null;
  }
  return principal;
}
