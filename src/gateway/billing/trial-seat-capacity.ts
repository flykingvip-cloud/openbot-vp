/**
 * 试用租户席位容量：平台 `enterprise.seatQuota` 为唯一真源。
 *
 * 试用流程统一（订阅 → 权益投影 → 席位授权），可变的只有试用席位数。
 * 目录 Trial 套餐的 viewer/creator 分档不得覆盖租户试用配额。
 */

import { loadConfig } from "../../config/config.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import type { PlatformAuthEnterprise } from "../platform-auth/store-types.js";
import { DEFAULT_TRIAL_SEATS } from "../platform-auth/trial-policy.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { listSeats } from "./seats-store.js";
import type { SeatRole } from "./types.js";

export function isTrialEnterprise(
  enterprise: Pick<PlatformAuthEnterprise, "status" | "plan" | "billingStatus">,
): boolean {
  return (
    enterprise.status === "trial" ||
    enterprise.billingStatus === "trialing" ||
    enterprise.plan === "trial"
  );
}

export function trialSeatQuotaFromEnterprise(
  enterprise: Pick<PlatformAuthEnterprise, "seatQuota" | "trialSeatQuotaSnapshot">,
): number {
  const quota = enterprise.seatQuota || enterprise.trialSeatQuotaSnapshot || DEFAULT_TRIAL_SEATS;
  return Math.max(1, Math.floor(quota));
}

/** 试用租户用平台席位总数覆盖套餐分档 maxSeats，避免 Trial catalog `{viewer:1}` 卡住占用员工。 */
export function overlayTrialMaxSeats<T extends { maxSeats: Partial<Record<SeatRole, number>> }>(
  entitlement: T,
  trialCap: number | null,
): T {
  if (trialCap == null) {
    return entitlement;
  }
  return { ...entitlement, maxSeats: { viewer: trialCap } };
}

function findEnterprise(
  enterprises: Record<string, PlatformAuthEnterprise>,
  enterpriseId: string,
): PlatformAuthEnterprise | null {
  const direct = enterprises[enterpriseId];
  if (direct) {
    return direct;
  }
  const canonical = canonicalizeTenantId(enterpriseId) ?? enterpriseId;
  return (
    Object.values(enterprises).find(
      (row) => (canonicalizeTenantId(row.id) ?? row.id) === canonical,
    ) ?? null
  );
}

/**
 * 试用租户返回可授权员工上限；非试用返回 null（沿用套餐分档配额）。
 */
export async function resolveTrialSeatCapacity(enterpriseId: string): Promise<number | null> {
  const trimmed = enterpriseId.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const cfg = loadConfig();
    const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return null;
    }
    const store = await loadPlatformAuthStore(authConfig);
    const enterprise = findEnterprise(store.enterprises, trimmed);
    if (!enterprise || !isTrialEnterprise(enterprise)) {
      return null;
    }
    return trialSeatQuotaFromEnterprise(enterprise);
  } catch {
    return null;
  }
}

export async function countActiveBillingSeats(
  enterpriseId: string,
  seatsStorePath?: string,
): Promise<number> {
  const seats = await listSeats(enterpriseId, seatsStorePath, { status: "active" });
  return seats.length;
}

export async function assertTrialBillingSeatAvailable(params: {
  enterpriseId: string;
  seatsStorePath?: string;
}): Promise<{ ok: true } | { ok: false; reason: string; cap: number }> {
  const cap = await resolveTrialSeatCapacity(params.enterpriseId);
  if (cap == null) {
    return { ok: true };
  }
  const active = await countActiveBillingSeats(params.enterpriseId, params.seatsStorePath);
  if (active >= cap) {
    return {
      ok: false,
      cap,
      reason: `试用席位已满（上限 ${cap}）`,
    };
  }
  return { ok: true };
}
