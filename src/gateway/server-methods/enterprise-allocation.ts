/**
 * 企业资源分配总览（天花板套餐 + 角色价差 + 模型 grant）。
 *
 * 方法：
 * - enterprise-allocation.overview — 只读总览（订阅天花板、角色档案、席位价、现有 grant）
 * - enterprise-allocation.apply-profile — 手动为席位重应用角色档案
 */

import { getPlan, getPlanVersion } from "../billing/plans-store.js";
import { listSeats } from "../billing/seats-store.js";
import { getActiveSubscription } from "../billing/subscriptions-store.js";
import type { SeatRole } from "../billing/types.js";
import { applyRoleGrantProfileForSeat } from "../model-entitlement/apply-role-grant-profile.js";
import { getEnterpriseModelEntitlement } from "../model-entitlement/enterprise-model-entitlement-store.js";
import { mirrorBillingGrantToOrgSeats } from "../model-entitlement/mirror-billing-grant-to-org-seats.js";
import { getPlanVersionModelBinding } from "../model-entitlement/plan-version-model-binding-store.js";
import {
  listRoleGrantProfiles,
  resolveEnterpriseTierCeiling,
} from "../model-entitlement/role-grant-profiles.js";
import { listSeatModelGrantsForTenant } from "../model-entitlement/seat-model-grant-store.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import {
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

const SEAT_ROLES: Set<SeatRole> = new Set(["viewer", "creator", "admin"]);

function parseRole(value: unknown): SeatRole | null {
  const role = stringValue(value) as SeatRole | null;
  return role && SEAT_ROLES.has(role) ? role : null;
}

function seatPriceCents(
  pricing: Array<{ type: string; key: string; priceCents: number }>,
  role: SeatRole,
): number | null {
  const entry = pricing.find((p) => p.type === "seat" && p.key === `seat/${role}`);
  return entry?.priceCents ?? null;
}

export const enterpriseAllocationHandlers: GatewayRequestHandlers = {
  "enterprise-allocation.overview": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const subscription = await getActiveSubscription(scope.enterpriseId);
      const entitlement = await getEnterpriseModelEntitlement(scope.enterpriseId);
      const grants = await listSeatModelGrantsForTenant(scope.enterpriseId);
      const seats = await listSeats(scope.enterpriseId);
      const catalog = await listResourceModelCatalog();

      let planView = null;
      let planVersion = null;
      let entitlementSnapshot = null;
      let binding = null;
      let pricing: Array<{ type: string; key: string; priceCents: number }> = [];

      if (subscription) {
        planView = await getPlan(subscription.planId);
        planVersion = await getPlanVersion(subscription.planVersionId);
        entitlementSnapshot = await getPlanEntitlementSnapshot(subscription.planVersionId);
        binding = await getPlanVersionModelBinding(subscription.planVersionId);
        pricing = planVersion?.snapshot.pricing ?? [];
      }

      const allowedModelIds = entitlement?.allowedModelIds ?? [];
      const allowedTiers = entitlementSnapshot?.allowedTiers ?? binding?.allowedTiers ?? [];
      const tierCeiling = resolveEnterpriseTierCeiling({
        enterpriseAllowedModelIds: allowedModelIds,
        enterpriseAllowedTiers: allowedTiers,
        catalog,
      });

      const roleProfiles = listRoleGrantProfiles({
        enterpriseAllowedModelIds: allowedModelIds,
        enterpriseAllowedTiers: allowedTiers,
        catalog,
      }).map((profile) => ({
        ...profile,
        seatPriceCents: seatPriceCents(pricing, profile.role),
      }));

      respond(true, {
        subscribed: Boolean(subscription),
        strategy: "ceiling_plan_role_grant",
        ceiling: {
          planName: planView?.name ?? null,
          planVersionId: subscription?.planVersionId ?? null,
          allowedTiers: tierCeiling,
          entitledModelCount: allowedModelIds.length,
          monthlyCredits: entitlementSnapshot?.monthlyCredits ?? null,
        },
        roleProfiles,
        seats: seats.map((seat) => {
          const grant = grants.find(
            (g) => g.subjectType === "seat" && g.subjectId === seat.id && g.status === "active",
          );
          return {
            ...seat,
            grantedModelCount: grant?.grantedModelIds.length ?? 0,
          };
        }),
        grants,
        guide: {
          summary:
            "订阅天花板套餐定义企业资源上限；席位角色决定计费单价与默认模型层；模型授权可在角色档案基础上微调。",
          steps: [
            "选择能满足最高岗位需求的套餐（天花板）",
            "按岗位分配席位角色（viewer / creator / admin）",
            "系统自动应用角色模型档案；可在「访问控制」中微调",
          ],
        },
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-allocation.apply-profile": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      if (!scope.isEnterpriseAdmin) {
        respondInvalid(respond, "仅企业管理员可应用席位模型档案。");
        return;
      }
      const seatId = stringValue(params.seatId);
      const role = parseRole(params.role);
      if (!seatId) {
        respondInvalid(respond, "seatId 是必填项");
        return;
      }
      if (!role) {
        respondInvalid(respond, `无效的角色：${String(params.role)}`);
        return;
      }
      const result = await applyRoleGrantProfileForSeat({
        tenantId: scope.enterpriseId,
        seatId,
        role,
        ...(client?.user ? { actorUserId: client.user } : {}),
      });
      if (!result.applied) {
        respondInvalid(respond, result.skippedReason ?? "无法应用角色模型档案");
        return;
      }
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-allocation.sync-all-seats": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      if (!scope.isEnterpriseAdmin) {
        respondInvalid(respond, "仅企业管理员可同步席位模型档案。");
        return;
      }
      const seats = await listSeats(scope.enterpriseId);
      let applied = 0;
      let skipped = 0;
      const results: Array<{
        seatId: string;
        role: string;
        applied: boolean;
        modelCount: number;
      }> = [];
      for (const seat of seats) {
        const result = await applyRoleGrantProfileForSeat({
          tenantId: scope.enterpriseId,
          seatId: seat.id,
          role: seat.currentRole,
          ...(client?.user ? { actorUserId: client.user } : {}),
        });
        if (result.applied) {
          applied += 1;
          if (result.grant) {
            await mirrorBillingGrantToOrgSeats({
              tenantId: scope.enterpriseId,
              userId: seat.userId,
              grant: result.grant,
              ...(client?.user ? { actorUserId: client.user } : {}),
            });
          }
        } else {
          skipped += 1;
        }
        results.push({
          seatId: seat.id,
          role: seat.currentRole,
          applied: result.applied,
          modelCount: result.profile?.modelCount ?? 0,
        });
      }
      respond(true, { applied, skipped, results });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
