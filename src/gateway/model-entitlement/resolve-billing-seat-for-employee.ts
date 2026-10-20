/**
 * 计费席位按员工解析：seats.assign 存 userId=邮箱，gate 侧 employeeId 常为 platform user id。
 */

import { loadConfig } from "../../config/config.js";
import { findBillingSeatByUserId } from "../billing/seats-store.js";
import type { Seat } from "../billing/types.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";

export async function resolveBillingSeatForEmployee(params: {
  tenantId: string;
  platformUserId?: string;
  userEmail?: string;
  billingSeatsStorePath?: string;
}): Promise<Seat | null> {
  const email = params.userEmail?.trim().toLowerCase();
  if (email) {
    const byEmail = await findBillingSeatByUserId(
      params.tenantId,
      email,
      params.billingSeatsStorePath,
    );
    if (byEmail) {
      return byEmail;
    }
  }

  const platformUserId = params.platformUserId?.trim();
  if (platformUserId?.includes("@")) {
    return findBillingSeatByUserId(params.tenantId, platformUserId, params.billingSeatsStorePath);
  }

  if (platformUserId) {
    const cfg = loadConfig();
    const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
    if (authConfig?.enabled) {
      const store = await loadPlatformAuthStore(authConfig);
      const user = store.users[platformUserId];
      const normalizedEmail = user?.normalizedEmail?.trim().toLowerCase();
      if (normalizedEmail) {
        return findBillingSeatByUserId(
          params.tenantId,
          normalizedEmail,
          params.billingSeatsStorePath,
        );
      }
    }
  }

  return null;
}
