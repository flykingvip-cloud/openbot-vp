import type { GatewayClient } from "openclaw/plugin-sdk/media-monitor";

export type MonitorAuthScope =
  | { role: "admin" }
  | { role: "tenant"; tenantId: string; agentId: string };

export class MonitorAuthError extends Error {
  readonly code = "forbidden";
  constructor(message: string) {
    super(message);
    this.name = "MonitorAuthError";
  }
}

function readScopes(client: GatewayClient | null | undefined): string[] {
  const raw = (client?.connect as { scopes?: unknown } | undefined)?.scopes;
  return Array.isArray(raw) ? raw.map(String) : [];
}

function isAdminClient(client: GatewayClient | null | undefined): boolean {
  const kind = client?.sessionKind;
  if (kind === "platform-super-admin" || kind === "platform-admin" || kind === "enterprise-admin") {
    return true;
  }
  return readScopes(client).includes("operator.admin");
}

/**
 * Resolve a trusted monitor auth scope.
 *
 * - Session tenant (when present) is authoritative; params cannot forge another tenant.
 * - Non-admin callers must supply agentId (and tenantId when no session tenant).
 * - Cross-tenant / missing identity → forbidden (never unfiltered dumps).
 * - Full-store access requires admin client + explicit `admin: true`.
 */
export function resolveMonitorAuth(params: {
  client?: GatewayClient | null;
  params?: Record<string, unknown> | null;
}): MonitorAuthScope {
  const client = params.client ?? null;
  const raw = params.params ?? {};
  const wantAdmin = raw.admin === true;
  const paramTenant =
    typeof raw.tenantId === "string" && raw.tenantId.trim() ? raw.tenantId.trim() : "";
  const paramAgent =
    typeof raw.agentId === "string" && raw.agentId.trim() ? raw.agentId.trim() : "";
  const sessionTenant =
    typeof client?.sessionTenantId === "string" && client.sessionTenantId.trim()
      ? client.sessionTenantId.trim()
      : "";

  if (wantAdmin) {
    if (!isAdminClient(client)) {
      throw new MonitorAuthError("forbidden: admin capability required");
    }
    return { role: "admin" };
  }

  const tenantId = sessionTenant || paramTenant;
  if (!tenantId) {
    throw new MonitorAuthError("forbidden: tenantId required");
  }
  if (sessionTenant && paramTenant && paramTenant !== sessionTenant) {
    throw new MonitorAuthError("forbidden: tenant mismatch with session");
  }
  if (!paramAgent) {
    throw new MonitorAuthError("forbidden: agentId required");
  }
  return { role: "tenant", tenantId, agentId: paramAgent };
}

export function authMatchesTarget(
  auth: MonitorAuthScope,
  target: { tenantId: string; agentId: string },
): boolean {
  if (auth.role === "admin") {
    return true;
  }
  return target.tenantId === auth.tenantId && target.agentId === auth.agentId;
}

export function requireTargetAccess(
  auth: MonitorAuthScope,
  target: { tenantId: string; agentId: string } | null | undefined,
): void {
  if (!target) {
    throw new MonitorAuthError("forbidden: target not found");
  }
  if (!authMatchesTarget(auth, target)) {
    throw new MonitorAuthError("forbidden: target outside auth scope");
  }
}
