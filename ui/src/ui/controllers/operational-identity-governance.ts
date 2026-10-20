/**
 * Operational Identity Governance — platform/enterprise monitoring controller (P2 Task 2.4).
 *
 * Consumes the read-only `user-operational-identity.governance.overview` RPC
 * (domain gate "any"; the gateway resolves scope from the trusted session, so the
 * client never sends a scope/tenant param). The same RPC serves platform (full)
 * and enterprise (own-tenant) sessions — the server downgrades automatically.
 */

import type { GatewayBrowserClient } from "../gateway.ts";
import { requestOpenBotAppRerender } from "../request-app-rerender.ts";

export type GovernanceUsageEventView = {
  eventId: string;
  ownerId: string;
  tenantId?: string;
  agentId: string;
  identityId: string;
  provider: string;
  action: string;
  result: "allowed" | "denied" | "reauth_required";
  denialCode?: string;
  createdAt: string;
};

export type GovernanceLifecycleEventView = {
  eventId: string;
  ownerId: string;
  tenantId?: string;
  identityId: string;
  provider: string;
  action: "created" | "reauthorized" | "revoked";
  createdAt: string;
};

export type GovernanceTenantBreakdownEntry = {
  tenantId: string;
  identities: number;
  activeGrants: number;
  denials: number;
};

export type OperationalIdentityGovernanceOverview = {
  scope: { kind: "platform" | "tenant" | "self"; tenantId?: string; ownerId?: string };
  totals: {
    identities: number;
    active: number;
    expired: number;
    reauthRequired: number;
    revoked: number;
  };
  activeGrants: number;
  pendingBindingRequests: number;
  recentUsage: GovernanceUsageEventView[];
  recentDenials: GovernanceUsageEventView[];
  recentLifecycle: GovernanceLifecycleEventView[];
  tenantBreakdown?: GovernanceTenantBreakdownEntry[];
};

export type OperationalIdentityGovernanceHost = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  operationalIdentityGovernance: OperationalIdentityGovernanceOverview | null;
  operationalIdentityGovernanceBusy: boolean;
  operationalIdentityGovernanceError: string | null;
};

export type OperationalIdentityGovernancePanelState = {
  overview: OperationalIdentityGovernanceOverview | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_TOTALS = {
  identities: 0,
  active: 0,
  expired: 0,
  reauthRequired: 0,
  revoked: 0,
} as const;

const CACHE_TTL_MS = 30_000;

let cachedOverview: OperationalIdentityGovernanceOverview | null = null;
let cachedError: string | null = null;
let pendingRefresh: Promise<void> | null = null;
let lastRefreshKey: string | null = null;
let lastRefreshStartedAt = 0;

/** Normalize a raw RPC payload into a fully-populated overview (defensive defaults). */
export function normalizeGovernanceOverview(
  payload: Partial<OperationalIdentityGovernanceOverview> | null | undefined,
): OperationalIdentityGovernanceOverview {
  return {
    scope: payload?.scope ?? { kind: "self" },
    totals: { ...EMPTY_TOTALS, ...payload?.totals },
    activeGrants: payload?.activeGrants ?? 0,
    pendingBindingRequests: payload?.pendingBindingRequests ?? 0,
    recentUsage: payload?.recentUsage ?? [],
    recentDenials: payload?.recentDenials ?? [],
    recentLifecycle: payload?.recentLifecycle ?? [],
    tenantBreakdown: payload?.tenantBreakdown,
  };
}

export async function refreshOperationalIdentityGovernanceOverview(
  host: OperationalIdentityGovernanceHost,
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.operationalIdentityGovernanceBusy = true;
  host.operationalIdentityGovernanceError = null;
  try {
    const payload = await host.client.request<Partial<OperationalIdentityGovernanceOverview>>(
      "user-operational-identity.governance.overview",
      {},
    );
    host.operationalIdentityGovernance = normalizeGovernanceOverview(payload);
  } catch (error) {
    host.operationalIdentityGovernanceError =
      error instanceof Error ? error.message : "运营身份监管数据刷新失败。";
  } finally {
    host.operationalIdentityGovernanceBusy = false;
  }
}

function notifyOperationalIdentityGovernanceUpdated(): void {
  // Do not synthesize popstate here — that re-enters onPopState → refreshActiveTab
  // → loadOverview and amplifies enterprise settings nav lag. A targeted Lit
  // rerender is enough for panel state that lives outside @state.
  requestOpenBotAppRerender();
}

export function readOperationalIdentityGovernancePanelState(): OperationalIdentityGovernancePanelState {
  return {
    overview: cachedOverview,
    loading: Boolean(pendingRefresh),
    error: cachedError,
  };
}

export function resetOperationalIdentityGovernancePanelState(): void {
  cachedOverview = null;
  cachedError = null;
  pendingRefresh = null;
  lastRefreshKey = null;
  lastRefreshStartedAt = 0;
}

export function ensureOperationalIdentityGovernanceOverview(input: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  refreshKey: string;
  force?: boolean;
}): void {
  if (!input.client || !input.connected) {
    return;
  }
  const now = Date.now();
  const keyChanged = input.refreshKey !== lastRefreshKey;
  if (keyChanged) {
    cachedOverview = null;
    cachedError = null;
    lastRefreshKey = input.refreshKey;
  }
  const stale =
    cachedOverview === null || cachedError !== null || now - lastRefreshStartedAt > CACHE_TTL_MS;
  if (pendingRefresh || (!input.force && !keyChanged && !stale)) {
    return;
  }
  lastRefreshStartedAt = now;
  cachedError = null;
  pendingRefresh = input.client
    .request<Partial<OperationalIdentityGovernanceOverview>>(
      "user-operational-identity.governance.overview",
      {},
    )
    .then((payload) => {
      cachedOverview = normalizeGovernanceOverview(payload);
    })
    .catch((error) => {
      cachedError = error instanceof Error ? error.message : "运营身份监管数据刷新失败。";
    })
    .finally(() => {
      pendingRefresh = null;
      notifyOperationalIdentityGovernanceUpdated();
    });
}
