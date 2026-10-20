/**
 * Tenant lifecycle runtime access gate.
 *
 * Bridges the platform-auth tenant lifecycle (`PlatformAuthEnterprise.status`)
 * into the commercial run authorization path so an `expired` (trial ended, past
 * any grace window) or `suspended` tenant is hard-stopped at runtime — not only
 * hidden in the UI.
 *
 * Fail-open by design: if platform-auth is disabled, the tenant is unknown, or
 * any read fails, we do NOT block (never break active tenants because of a
 * lifecycle lookup problem). Only a definitive expired/suspended status blocks.
 *
 * Note: a `read_only` expiry still blocks runs here — an agent run is an
 * execution, not a read; the read-only distinction only governs UI viewing.
 * Grace periods keep `status === "trial"` until the window closes (see
 * enterprise-lifecycle.ts), so an `expired` status already means grace elapsed.
 */

import { loadConfig } from "../../config/config.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { resolvePlatformAuthConfig } from "./config.js";
import type { EnterpriseStatus, PlatformAuthEnterprise, PlatformAuthStore } from "./store-types.js";
import { loadPlatformAuthStore } from "./store.js";

export const TENANT_EXPIRED_RUN_MESSAGE =
  "该企业的试用 / 订阅已到期，AI 运行已暂停。请续费或联系平台管理员恢复。";
export const TENANT_SUSPENDED_RUN_MESSAGE =
  "该企业已被暂停，暂时无法执行 AI 任务。请联系平台管理员。";

export type TenantLifecycleAccess = {
  /** true = the tenant is hard-blocked from commercial runs. */
  blocked: boolean;
  status?: EnterpriseStatus;
  reason?: "expired" | "suspended";
  message?: string;
};

/**
 * Pure decision: given a tenant's enterprise record (or null when unknown),
 * decide whether commercial runs are blocked. Kept pure for unit testing.
 */
export function evaluateTenantLifecycle(
  enterprise: Pick<PlatformAuthEnterprise, "status"> | null | undefined,
): TenantLifecycleAccess {
  if (!enterprise) {
    return { blocked: false };
  }
  if (enterprise.status === "expired") {
    return {
      blocked: true,
      status: "expired",
      reason: "expired",
      message: TENANT_EXPIRED_RUN_MESSAGE,
    };
  }
  if (enterprise.status === "suspended") {
    return {
      blocked: true,
      status: "suspended",
      reason: "suspended",
      message: TENANT_SUSPENDED_RUN_MESSAGE,
    };
  }
  return { blocked: false, status: enterprise.status };
}

function findEnterprise(store: PlatformAuthStore, tenantId: string): PlatformAuthEnterprise | null {
  const target = canonicalizeTenantId(tenantId) ?? tenantId;
  for (const [key, enterprise] of Object.entries(store.enterprises)) {
    const canon = canonicalizeTenantId(key) ?? key;
    if (canon === target || enterprise.slug === target || enterprise.id === target) {
      return enterprise;
    }
  }
  return null;
}

/**
 * Resolve whether a tenant (by canonical tenant id / enterprise id) is blocked
 * from commercial runs by its platform-auth lifecycle status. Fail-open on any
 * error or when platform-auth is not enabled.
 */
export async function resolveTenantLifecycleAccess(
  tenantId: string,
): Promise<TenantLifecycleAccess> {
  const id = tenantId?.trim();
  if (!id) {
    return { blocked: false };
  }
  try {
    const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return { blocked: false };
    }
    const store = await loadPlatformAuthStore(authConfig);
    return evaluateTenantLifecycle(findEnterprise(store, id));
  } catch {
    // Never break a run because the lifecycle lookup failed.
    return { blocked: false };
  }
}
