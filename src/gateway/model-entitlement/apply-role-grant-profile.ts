/**
 * 为席位应用角色默认模型授权档案（IO 编排）。
 */

import { getActiveSubscription } from "../billing/subscriptions-store.js";
import type { SeatRole } from "../billing/types.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import { getEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { getPlanVersionModelBinding } from "./plan-version-model-binding-store.js";
import { resolveRoleGrantProfile, type RoleGrantProfile } from "./role-grant-profiles.js";
import { setModelGrant } from "./seat-model-grant-store.js";
import type { SeatModelGrant } from "./types.js";

export type ApplyRoleGrantProfileInput = {
  tenantId: string;
  seatId: string;
  role: SeatRole;
  actorUserId?: string;
  subscriptionsStorePath?: string;
  planBindingStorePath?: string;
  entitlementStorePath?: string;
  seatGrantStorePath?: string;
  modelCatalogStorePath?: string;
  entitlementSnapshotStorePath?: string;
};

export type ApplyRoleGrantProfileResult = {
  applied: boolean;
  grant: SeatModelGrant | null;
  profile: RoleGrantProfile | null;
  skippedReason?: string;
};

export async function applyRoleGrantProfileForSeat(
  input: ApplyRoleGrantProfileInput,
): Promise<ApplyRoleGrantProfileResult> {
  const entitlement = await getEnterpriseModelEntitlement(
    input.tenantId,
    input.entitlementStorePath,
  );
  if (!entitlement || entitlement.allowedModelIds.length === 0) {
    return {
      applied: false,
      grant: null,
      profile: null,
      skippedReason: "no enterprise model entitlement",
    };
  }

  const subscription = await getActiveSubscription(input.tenantId, input.subscriptionsStorePath);
  const binding = subscription?.planVersionId
    ? await getPlanVersionModelBinding(subscription.planVersionId, input.planBindingStorePath)
    : null;
  const snapshot = subscription?.planVersionId
    ? await getPlanEntitlementSnapshot(
        subscription.planVersionId,
        input.entitlementSnapshotStorePath,
      )
    : null;

  const catalog = await listResourceModelCatalog(input.modelCatalogStorePath);
  const profile = resolveRoleGrantProfile({
    role: input.role,
    enterpriseAllowedModelIds: entitlement.allowedModelIds,
    enterpriseAllowedTiers: snapshot?.allowedTiers ?? binding?.allowedTiers ?? null,
    catalog,
  });

  if (profile.modelIds.length === 0) {
    return {
      applied: false,
      grant: null,
      profile,
      skippedReason: "role profile resolved to empty model set",
    };
  }

  const grant = await setModelGrant(
    {
      tenantId: input.tenantId,
      subjectType: "seat",
      subjectId: input.seatId,
      seatId: input.seatId,
      grantedModelIds: profile.modelIds,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    },
    input.seatGrantStorePath,
  );

  return { applied: true, grant, profile };
}
