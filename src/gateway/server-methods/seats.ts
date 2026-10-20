/**
 * 企业 Seat handler（WRITE / READ）。独立于订阅（R5）。
 *
 * 方法：
 * - seats.assign / seats.set-role / seats.list
 * - seats.deactivate / seats.remove / seats.reactivate（Phase 3 生命周期）
 */

import {
  getAiJobTemplate,
  isSeatEntitlementProfileUpgrade,
  parseAiJobTemplateId,
} from "../billing/ai-job-templates.js";
import { billingEventBus } from "../billing/event-bus.js";
import {
  getOverAllocationState,
  isActionBlockedByOverAllocation,
} from "../billing/over-allocation-store.js";
import { getPlanVersion } from "../billing/plans-store.js";
import { refreshEnterpriseOverAllocationIfSubscribed } from "../billing/refresh-enterprise-over-allocation.js";
import {
  assignDefaultSeatEntitlementProfile,
  getSeatEntitlementAssignment,
  parseSeatEntitlementProfileId,
  upsertSeatEntitlementAssignment,
} from "../billing/seat-entitlement-assignments-store.js";
import { defaultSeatEntitlementProfileForRole } from "../billing/seat-entitlement-profiles.js";
import {
  assignSeat,
  deactivateSeat,
  DuplicateActiveSeatError,
  listSeatIntervals,
  listSeats,
  reactivateSeat,
  removeSeat,
  resolveSeatStatus,
  SeatLifecycleError,
  SeatRoleQuotaExceededError,
  setSeatRole,
} from "../billing/seats-store.js";
import { getActiveSubscription } from "../billing/subscriptions-store.js";
import { resolveTrialSeatCapacity } from "../billing/trial-seat-capacity.js";
import type { SeatRole } from "../billing/types.js";
import { applyRoleGrantProfileForSeat } from "../model-entitlement/apply-role-grant-profile.js";
import { mirrorBillingGrantToOrgSeats } from "../model-entitlement/mirror-billing-grant-to-org-seats.js";
import {
  numberValue,
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

/** 默认 true：分配/变更席位角色时自动应用角色模型档案。 */
function shouldApplyModelGrant(params: Record<string, unknown>): boolean {
  return params.applyModelGrant !== false;
}

export const seatsHandlers: GatewayRequestHandlers = {
  "seats.assign": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const userId = stringValue(params.userId);
      const role = parseRole(params.role);
      const jobTemplateId = parseAiJobTemplateId(params.jobTemplateId);
      const jobTemplate = jobTemplateId ? getAiJobTemplate(jobTemplateId) : null;
      const botQuota =
        numberValue(params.botQuota) ?? (jobTemplate ? jobTemplate.suggestedBotQuota : 0);
      const effectiveRole = role ?? (jobTemplate ? jobTemplate.suggestedSeatRole : null);
      if (!userId) {
        respondInvalid(respond, "userId 是必填项");
        return;
      }
      if (!effectiveRole) {
        respondInvalid(respond, `无效的角色：${String(params.role)}`);
        return;
      }
      if (jobTemplateId && !jobTemplate) {
        respondInvalid(respond, `无效的岗位模板：${jobTemplateId}`);
        return;
      }
      if (botQuota < 0) {
        respondInvalid(respond, "botQuota 不能为负数");
        return;
      }
      const overAllocation = await getOverAllocationState(scope.enterpriseId);
      const trialCap = await resolveTrialSeatCapacity(scope.enterpriseId);
      if (trialCap == null && isActionBlockedByOverAllocation(overAllocation, "assign_seat")) {
        respondInvalid(
          respond,
          "当前订阅处于超配治理状态，无法新增席位。请先清理超额资源或升级套餐。",
        );
        return;
      }
      if (trialCap != null) {
        const activeSeats = await listSeats(scope.enterpriseId, undefined, { status: "active" });
        if (activeSeats.length >= trialCap) {
          respondInvalid(respond, `试用席位已满（上限 ${trialCap}）`);
          return;
        }
      }
      // 配额真源：试用租户用平台 seatQuota；付费租户锁定 subscription.planVersionId。
      const subscription = await getActiveSubscription(scope.enterpriseId);
      const lockedPlanVersionId = subscription?.planVersionId;
      let roleQuota: number | undefined;
      if (trialCap == null && subscription && lockedPlanVersionId) {
        const version = await getPlanVersion(lockedPlanVersionId);
        const q = version?.snapshot.seatQuota[effectiveRole];
        if (typeof q === "number") {
          roleQuota = q;
        }
      }
      let seat;
      try {
        seat = await assignSeat({
          enterpriseId: scope.enterpriseId,
          userId,
          role: effectiveRole,
          botQuota: Math.floor(botQuota),
          ...(lockedPlanVersionId ? { planVersionId: lockedPlanVersionId } : {}),
          ...(roleQuota !== undefined ? { roleQuota } : {}),
        });
      } catch (err) {
        if (
          err instanceof DuplicateActiveSeatError ||
          err instanceof SeatLifecycleError ||
          err instanceof SeatRoleQuotaExceededError
        ) {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
      const profileId =
        parseSeatEntitlementProfileId(params.entitlementProfileId) ??
        jobTemplate?.profileId ??
        (trialCap != null ? "basic_ai" : null);
      const seatEntitlement = profileId
        ? await upsertSeatEntitlementAssignment({
            enterpriseId: scope.enterpriseId,
            seatId: seat.id,
            profileId,
          })
        : await assignDefaultSeatEntitlementProfile({
            enterpriseId: scope.enterpriseId,
            seatId: seat.id,
            role: effectiveRole,
          });
      await billingEventBus.publish({
        type: "seat.changed",
        enterpriseId: scope.enterpriseId,
        seatId: seat.id,
        fromRole: null,
        toRole: effectiveRole,
        effectiveAt: seat.createdAt,
        action: "assigned",
        toStatus: "active",
      });
      await refreshEnterpriseOverAllocationIfSubscribed(scope.enterpriseId);
      let modelGrant = null;
      if (shouldApplyModelGrant(params)) {
        const grantResult = await applyRoleGrantProfileForSeat({
          tenantId: scope.enterpriseId,
          seatId: seat.id,
          role: effectiveRole,
          ...(client?.user ? { actorUserId: client.user } : {}),
        });
        if (grantResult.applied) {
          modelGrant = {
            grant: grantResult.grant,
            profile: grantResult.profile,
          };
          if (grantResult.grant) {
            await mirrorBillingGrantToOrgSeats({
              tenantId: scope.enterpriseId,
              userId,
              grant: grantResult.grant,
              ...(client?.user ? { actorUserId: client.user } : {}),
            });
          }
        }
      }
      respond(true, { seat, seatEntitlement, ...(modelGrant ? { modelGrant } : {}) });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "seats.set-role": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const seatId = stringValue(params.seatId);
      const role = parseRole(params.role);
      const requestedProfileId = parseSeatEntitlementProfileId(params.entitlementProfileId);
      if (!seatId) {
        respondInvalid(respond, "seatId 是必填项");
        return;
      }
      if (!role) {
        respondInvalid(respond, `无效的角色：${String(params.role)}`);
        return;
      }
      const existingAssignment = await getSeatEntitlementAssignment(scope.enterpriseId, seatId);
      const seatsBefore = await listSeats(scope.enterpriseId);
      const seatBefore = seatsBefore.find((row) => row.id === seatId);
      if (!seatBefore) {
        respondInvalid(respond, `未找到席位：${seatId}`);
        return;
      }
      if (resolveSeatStatus(seatBefore) !== "active") {
        respondInvalid(
          respond,
          `席位 ${seatId} 状态为 ${resolveSeatStatus(seatBefore)}，仅 active 可变更角色`,
        );
        return;
      }
      const currentProfileId =
        existingAssignment?.profileId ??
        defaultSeatEntitlementProfileForRole(seatBefore.currentRole);
      const nextProfileId =
        requestedProfileId ??
        (existingAssignment
          ? existingAssignment.profileId
          : defaultSeatEntitlementProfileForRole(role));
      if (isSeatEntitlementProfileUpgrade(currentProfileId, nextProfileId)) {
        const overAllocation = await getOverAllocationState(scope.enterpriseId);
        if (isActionBlockedByOverAllocation(overAllocation, "upgrade_seat_profile")) {
          respondInvalid(
            respond,
            "当前订阅处于超配治理状态，无法升级席位 AI 档位。请先清理超额资源或升级套餐。",
          );
          return;
        }
      }
      // 角色配额：试用租户用平台总席位；付费租户锁定订阅 planVersion。
      const trialCap = await resolveTrialSeatCapacity(scope.enterpriseId);
      const subscription = await getActiveSubscription(scope.enterpriseId);
      let roleQuota: number | undefined;
      if (trialCap == null && subscription?.planVersionId && role !== seatBefore.currentRole) {
        const version = await getPlanVersion(subscription.planVersionId);
        const q = version?.snapshot.seatQuota[role];
        if (typeof q === "number") {
          roleQuota = q;
        }
      }
      let result;
      try {
        result = await setSeatRole(
          scope.enterpriseId,
          seatId,
          role,
          undefined,
          roleQuota !== undefined ? { roleQuota } : {},
        );
      } catch (err) {
        if (err instanceof SeatLifecycleError || err instanceof SeatRoleQuotaExceededError) {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
      if (!result) {
        respondInvalid(respond, `未找到席位：${seatId}`);
        return;
      }
      let seatEntitlement = existingAssignment;
      if (nextProfileId !== existingAssignment?.profileId) {
        seatEntitlement = await upsertSeatEntitlementAssignment({
          enterpriseId: scope.enterpriseId,
          seatId,
          profileId: nextProfileId,
        });
      }
      await billingEventBus.publish({
        type: "seat.changed",
        enterpriseId: scope.enterpriseId,
        seatId,
        fromRole: result.closed.role,
        toRole: role,
        effectiveAt: result.opened.startTime,
        action: "role_changed",
        fromStatus: "active",
        toStatus: "active",
      });
      await refreshEnterpriseOverAllocationIfSubscribed(scope.enterpriseId);
      let modelGrant = null;
      if (shouldApplyModelGrant(params)) {
        const grantResult = await applyRoleGrantProfileForSeat({
          tenantId: scope.enterpriseId,
          seatId,
          role,
          ...(client?.user ? { actorUserId: client.user } : {}),
        });
        if (grantResult.applied) {
          modelGrant = {
            grant: grantResult.grant,
            profile: grantResult.profile,
          };
          if (grantResult.grant) {
            await mirrorBillingGrantToOrgSeats({
              tenantId: scope.enterpriseId,
              userId: result.seat.userId,
              grant: grantResult.grant,
              ...(client?.user ? { actorUserId: client.user } : {}),
            });
          }
        }
      }
      respond(true, {
        seat: result.seat,
        interval: result.opened,
        ...(seatEntitlement ? { seatEntitlement } : {}),
        ...(modelGrant ? { modelGrant } : {}),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "seats.list": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const statusFilter = stringValue(params.status);
      const seats = await listSeats(
        scope.enterpriseId,
        undefined,
        statusFilter === "active" || statusFilter === "inactive" || statusFilter === "removed"
          ? { status: statusFilter }
          : undefined,
      );
      const intervals = await listSeatIntervals(scope.enterpriseId);
      respond(true, { seats, intervals });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "seats.deactivate": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const seatId = stringValue(params.seatId);
      if (!seatId) {
        respondInvalid(respond, "seatId 是必填项");
        return;
      }
      let result;
      try {
        result = await deactivateSeat(scope.enterpriseId, seatId);
      } catch (err) {
        if (err instanceof SeatLifecycleError) {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
      if (!result) {
        respondInvalid(respond, `未找到席位：${seatId}`);
        return;
      }
      await billingEventBus.publish({
        type: "seat.changed",
        enterpriseId: scope.enterpriseId,
        seatId,
        fromRole: result.seat.currentRole,
        toRole: result.seat.currentRole,
        effectiveAt: result.seat.updatedAt ?? new Date().toISOString(),
        action: "deactivated",
        fromStatus: "active",
        toStatus: "inactive",
      });
      await refreshEnterpriseOverAllocationIfSubscribed(scope.enterpriseId);
      respond(true, { seat: result.seat, closedInterval: result.closed });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "seats.remove": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const seatId = stringValue(params.seatId);
      if (!seatId) {
        respondInvalid(respond, "seatId 是必填项");
        return;
      }
      let result;
      try {
        result = await removeSeat(scope.enterpriseId, seatId);
      } catch (err) {
        if (err instanceof SeatLifecycleError) {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
      if (!result) {
        respondInvalid(respond, `未找到席位：${seatId}`);
        return;
      }
      await billingEventBus.publish({
        type: "seat.changed",
        enterpriseId: scope.enterpriseId,
        seatId,
        fromRole: result.seat.currentRole,
        toRole: result.seat.currentRole,
        effectiveAt: result.seat.updatedAt ?? new Date().toISOString(),
        action: "removed",
        toStatus: "removed",
      });
      await refreshEnterpriseOverAllocationIfSubscribed(scope.enterpriseId);
      respond(true, { seat: result.seat, closedInterval: result.closed });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "seats.reactivate": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const seatId = stringValue(params.seatId);
      if (!seatId) {
        respondInvalid(respond, "seatId 是必填项");
        return;
      }
      const seats = await listSeats(scope.enterpriseId);
      const target = seats.find((s) => s.id === seatId);
      if (!target) {
        respondInvalid(respond, `未找到席位：${seatId}`);
        return;
      }
      // 角色配额：试用租户用平台总席位；付费租户锁定 planVersion。
      const trialCap = await resolveTrialSeatCapacity(scope.enterpriseId);
      let roleQuota: number | undefined;
      if (resolveSeatStatus(target) === "inactive") {
        if (trialCap != null) {
          const activeSeats = await listSeats(scope.enterpriseId, undefined, { status: "active" });
          if (activeSeats.length >= trialCap) {
            respondInvalid(respond, `试用席位已满（上限 ${trialCap}）`);
            return;
          }
        } else {
          const subscription = await getActiveSubscription(scope.enterpriseId);
          if (subscription?.planVersionId) {
            const version = await getPlanVersion(subscription.planVersionId);
            const q = version?.snapshot.seatQuota[target.currentRole];
            if (typeof q === "number") {
              roleQuota = q;
            }
          }
        }
      }
      let result;
      try {
        result = await reactivateSeat(
          scope.enterpriseId,
          seatId,
          undefined,
          roleQuota !== undefined ? { roleQuota } : {},
        );
      } catch (err) {
        if (
          err instanceof DuplicateActiveSeatError ||
          err instanceof SeatLifecycleError ||
          err instanceof SeatRoleQuotaExceededError
        ) {
          respondInvalid(respond, err.message);
          return;
        }
        throw err;
      }
      if (!result) {
        respondInvalid(respond, `未找到席位：${seatId}`);
        return;
      }
      await billingEventBus.publish({
        type: "seat.changed",
        enterpriseId: scope.enterpriseId,
        seatId,
        fromRole: result.seat.currentRole,
        toRole: result.seat.currentRole,
        effectiveAt: result.opened.startTime,
        action: "reactivated",
        fromStatus: "inactive",
        toStatus: "active",
      });
      await refreshEnterpriseOverAllocationIfSubscribed(scope.enterpriseId);
      respond(true, { seat: result.seat, interval: result.opened });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
