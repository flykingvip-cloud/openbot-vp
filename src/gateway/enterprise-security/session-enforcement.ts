/**
 * Idle timeout and IP allowlist enforcement for one platform-auth session row.
 * A missing control file does nothing. Unreadable policy fails closed.
 */
import type { PlatformAuthSessionRecord } from "../platform-auth/store-types.js";
import { ipMatchesAllowlist } from "./cidr.js";
import { readTenantControls } from "./tenant-controls-store.js";

const ACTIVITY_THROTTLE_MS = 60_000;

export type SessionControlDecision =
  | { action: "allow"; touched: boolean }
  | { action: "drop"; reason: "idle" }
  | { action: "deny"; reason: "ip" | "policy_unreadable" };

function activityMs(session: PlatformAuthSessionRecord): number {
  const raw = session.lastActivityAt ?? session.updatedAt ?? session.sessionIssuedAt;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function applyStoredSessionControls(params: {
  session: PlatformAuthSessionRecord;
  clientIp: string | undefined;
  nowMs: number;
}): Promise<SessionControlDecision> {
  const tenantId = params.session.enterpriseId?.trim();
  if (!tenantId) {
    return { action: "allow", touched: false };
  }
  let idleTimeoutMinutes: number | undefined;
  let ipAllowlist: string[] = [];
  try {
    const controls = await readTenantControls(tenantId);
    idleTimeoutMinutes = controls.idleTimeoutMinutes;
    ipAllowlist = controls.ipAllowlist ?? [];
  } catch {
    return { action: "deny", reason: "policy_unreadable" };
  }
  if (
    typeof idleTimeoutMinutes === "number" &&
    params.nowMs - activityMs(params.session) > idleTimeoutMinutes * 60_000
  ) {
    return { action: "drop", reason: "idle" };
  }
  if (!ipMatchesAllowlist(params.clientIp, ipAllowlist)) {
    return { action: "deny", reason: "ip" };
  }
  if (params.nowMs - activityMs(params.session) >= ACTIVITY_THROTTLE_MS) {
    params.session.lastActivityAt = new Date(params.nowMs).toISOString();
    return { action: "allow", touched: true };
  }
  return { action: "allow", touched: false };
}

export async function isEnterpriseCallerIpAllowed(
  tenantId: string,
  clientIp: string | undefined,
): Promise<boolean> {
  const controls = await readTenantControls(tenantId);
  return ipMatchesAllowlist(clientIp, controls.ipAllowlist ?? []);
}
