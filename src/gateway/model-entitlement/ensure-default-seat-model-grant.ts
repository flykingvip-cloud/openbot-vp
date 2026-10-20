/**
 * 员工激活 / 运行时兜底：席位尚无可用模型授权时，按企业套餐最低档（viewer / Tier A）落 grant。
 *
 * 避免「只完成入职激活、未点同步席位授权」导致员工端硬性无法调模型。
 */

import type { SeatRole } from "../billing/types.js";
import {
  applyRoleGrantProfileForSeat,
  type ApplyRoleGrantProfileResult,
} from "./apply-role-grant-profile.js";
import { getSeatModelGrant } from "./seat-model-grant-store.js";
import type { SeatModelGrant } from "./types.js";

/** 套餐最低标准对应的席位角色（Tier A）。 */
export const DEFAULT_EMPLOYEE_SEAT_MODEL_ROLE: SeatRole = "viewer";

function hasUsableActiveGrant(grant: SeatModelGrant | null | undefined): boolean {
  return Boolean(
    grant && grant.status === "active" && grant.grantedModelIds.some((id) => id.trim().length > 0),
  );
}

export type EnsureDefaultSeatModelGrantInput = {
  tenantId: string;
  seatId: string;
  actorUserId?: string;
  /** 默认 viewer（企业套餐最低档）。 */
  role?: SeatRole;
  subscriptionsStorePath?: string;
  planBindingStorePath?: string;
  entitlementStorePath?: string;
  seatGrantStorePath?: string;
  modelCatalogStorePath?: string;
  entitlementSnapshotStorePath?: string;
};

/**
 * 若席位已有可用 active grant → 跳过；否则按最低档角色写入模型授权。
 * 企业 entitlement 为空时返回 skipped（不抛错），由调用方决定是否阻断激活。
 */
export async function ensureDefaultSeatModelGrant(
  input: EnsureDefaultSeatModelGrantInput,
): Promise<ApplyRoleGrantProfileResult> {
  const seatId = input.seatId.trim();
  const tenantId = input.tenantId.trim();
  if (!seatId || !tenantId) {
    return {
      applied: false,
      grant: null,
      profile: null,
      skippedReason: "tenantId/seatId required",
    };
  }

  const existing = await getSeatModelGrant(tenantId, seatId, input.seatGrantStorePath);
  if (hasUsableActiveGrant(existing)) {
    return {
      applied: false,
      grant: existing,
      profile: null,
      skippedReason: "seat already has active model grant",
    };
  }

  return applyRoleGrantProfileForSeat({
    tenantId,
    seatId,
    role: input.role ?? DEFAULT_EMPLOYEE_SEAT_MODEL_ROLE,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(input.subscriptionsStorePath
      ? { subscriptionsStorePath: input.subscriptionsStorePath }
      : {}),
    ...(input.planBindingStorePath ? { planBindingStorePath: input.planBindingStorePath } : {}),
    ...(input.entitlementStorePath ? { entitlementStorePath: input.entitlementStorePath } : {}),
    ...(input.seatGrantStorePath ? { seatGrantStorePath: input.seatGrantStorePath } : {}),
    ...(input.modelCatalogStorePath ? { modelCatalogStorePath: input.modelCatalogStorePath } : {}),
    ...(input.entitlementSnapshotStorePath
      ? { entitlementSnapshotStorePath: input.entitlementSnapshotStorePath }
      : {}),
  });
}
