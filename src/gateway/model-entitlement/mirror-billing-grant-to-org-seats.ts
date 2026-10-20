/**
 * 将 billing seat 上的模型授权镜像到组织岗位 seatId。
 * 员工聊天 gate 使用 org seatId 解析 grant，而 seats.assign 默认只写入 billing seatId。
 */

import { loadConfig } from "../../config/config.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  resolveControlPlaneStorePathForClient,
  resolveControlPlaneStorePathForTenantId,
} from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import { setModelGrant } from "./seat-model-grant-store.js";
import type { SeatModelGrant } from "./types.js";

type SeatBinding = {
  tenantId: string;
  employeeId: string;
  seatId: string;
  bindingStatus: string;
};

export type EmployeeBindingIdentity = {
  userId?: string;
  userEmail?: string;
  platformUserId?: string;
};

function addIdentityKey(keys: Set<string>, value?: string): void {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed) {
    keys.add(trimmed);
  }
}

/**
 * 解析员工在 org binding 上可能使用的标识（邮箱 / platform user id）。
 * binding.employeeId 可能是 UUID，而 seats.assign 传入的是邮箱。
 */
export async function buildEmployeeBindingIdentityKeys(
  identity: EmployeeBindingIdentity,
): Promise<Set<string>> {
  const keys = new Set<string>();
  addIdentityKey(keys, identity.userId);
  addIdentityKey(keys, identity.userEmail);
  addIdentityKey(keys, identity.platformUserId);

  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return keys;
  }
  const store = await loadPlatformAuthStore(authConfig);

  const platformUserId =
    identity.platformUserId?.trim() ||
    (identity.userId?.trim() && !identity.userId.includes("@") ? identity.userId.trim() : "");
  if (platformUserId) {
    addIdentityKey(keys, platformUserId);
    addIdentityKey(keys, store.users[platformUserId]?.normalizedEmail);
  }

  const email =
    identity.userEmail?.trim().toLowerCase() ||
    (identity.userId?.includes("@") ? identity.userId.trim().toLowerCase() : "");
  if (email) {
    addIdentityKey(keys, email);
    for (const user of Object.values(store.users)) {
      if (user.normalizedEmail?.trim().toLowerCase() === email) {
        addIdentityKey(keys, user.id);
      }
    }
  }

  return keys;
}

export function listOrgSeatIdsForEmployee(
  tenantId: string,
  employeeId: string,
  bindings: Record<string, SeatBinding>,
): string[] {
  const normalizedEmployee = employeeId.trim().toLowerCase();
  if (!normalizedEmployee) {
    return [];
  }
  const seatIds = new Set<string>();
  for (const binding of Object.values(bindings)) {
    if (
      binding.tenantId === tenantId &&
      binding.bindingStatus === "active" &&
      binding.employeeId.trim().toLowerCase() === normalizedEmployee
    ) {
      seatIds.add(binding.seatId);
    }
  }
  return [...seatIds];
}

export async function listOrgSeatIdsForEmployeeIdentity(
  tenantId: string,
  identity: EmployeeBindingIdentity,
  bindings: Record<string, SeatBinding>,
): Promise<string[]> {
  const keys = await buildEmployeeBindingIdentityKeys(identity);
  if (keys.size === 0) {
    return [];
  }
  const seatIds = new Set<string>();
  for (const binding of Object.values(bindings)) {
    if (binding.tenantId !== tenantId || binding.bindingStatus !== "active") {
      continue;
    }
    if (keys.has(binding.employeeId.trim().toLowerCase())) {
      seatIds.add(binding.seatId);
    }
  }
  return [...seatIds];
}

export async function mirrorBillingGrantToOrgSeats(params: {
  tenantId: string;
  userId: string;
  grant: SeatModelGrant;
  actorUserId?: string;
  seatGrantStorePath?: string;
  userEmail?: string;
  platformUserId?: string;
  client?: GatewayClient | null;
}): Promise<string[]> {
  // Agent-run sync often has tenantId but no GatewayClient. Prefer tenant-id
  // addressing so dual-role/platform sessions do not throw unresolved_tenant
  // from strict resolveControlPlaneStorePathForClient(null).
  const storePath =
    resolveControlPlaneStorePathForTenantId(params.tenantId, TENANT_SEAT_ASSETS_FILE) ??
    (await resolveControlPlaneStorePathForClient(params.client ?? null, TENANT_SEAT_ASSETS_FILE));
  const store = await loadEnterpriseSeatAssetsStore(storePath);
  const orgSeatIds = await listOrgSeatIdsForEmployeeIdentity(
    params.tenantId,
    {
      userId: params.userId,
      userEmail: params.userEmail ?? (params.userId.includes("@") ? params.userId : undefined),
      platformUserId: params.platformUserId,
    },
    store.bindings,
  );
  const mirrored: string[] = [];
  for (const orgSeatId of orgSeatIds) {
    await setModelGrant(
      {
        tenantId: params.tenantId,
        subjectType: "seat",
        subjectId: orgSeatId,
        seatId: orgSeatId,
        grantedModelIds: params.grant.grantedModelIds,
        // Preserve enterprise BYOK (ent/*) already on the org seat while
        // mirroring billing/plan grants — replace would wipe private models.
        mergeMode: "union",
        ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      },
      params.seatGrantStorePath,
    );
    mirrored.push(orgSeatId);
  }
  return mirrored;
}

/**
 * 将 billing 席位 grant 写入当前 org seatId，并镜像到员工绑定的其它 org 岗位。
 */
export async function syncBillingGrantToOrgSeat(params: {
  tenantId: string;
  orgSeatId: string;
  billingSeatId: string;
  grant: SeatModelGrant;
  userEmail?: string;
  platformUserId?: string;
  seatGrantStorePath?: string;
}): Promise<void> {
  const orgSeatId = params.orgSeatId.trim();
  if (!orgSeatId || orgSeatId === params.billingSeatId.trim()) {
    return;
  }
  await setModelGrant(
    {
      tenantId: params.tenantId,
      subjectType: "seat",
      subjectId: orgSeatId,
      seatId: orgSeatId,
      grantedModelIds: params.grant.grantedModelIds,
      mergeMode: "union",
    },
    params.seatGrantStorePath,
  );
  await mirrorBillingGrantToOrgSeats({
    tenantId: params.tenantId,
    userId: params.userEmail ?? params.platformUserId ?? "",
    userEmail: params.userEmail,
    platformUserId: params.platformUserId,
    grant: params.grant,
    seatGrantStorePath: params.seatGrantStorePath,
  });
}
