/**
 * 人岗同删：因人设岗时，注销该成员并删除岗位，不把岗位冻成交接壳。
 * 成员账本走 applyEnterpriseMemberOffboard；岗位删除走 deleteVacantPositionSeat。
 */

import {
  cancelSeatAssignmentOffer,
  deleteVacantPositionSeat,
  revokeAccessPolicies,
  revokeConnectorCredentialBindings,
  type EnterpriseSeatAssetsStore,
  type EnterprisePositionSeat,
} from "./enterprise-seat-assets-store.js";
import { revokePendingEmployeeProvisionsForSeat } from "./platform-auth/auth-helpers.js";
import { applyEnterpriseMemberOffboard } from "./platform-auth/member-offboard.js";
import { resolveMembershipSelectionForUser } from "./platform-auth/memberships.js";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";

function resolveSeatMemberEmployeeId(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seat: EnterprisePositionSeat;
}): string | null {
  const current = params.seat.currentEmployeeId?.trim();
  if (current) {
    return current;
  }
  const activeBinding = Object.values(params.store.bindings).find(
    (binding) =>
      binding.tenantId === params.tenantId &&
      binding.seatId === params.seat.seatId &&
      binding.bindingStatus === "active",
  );
  if (activeBinding?.employeeId.trim()) {
    return activeBinding.employeeId.trim();
  }
  const openHandover = Object.values(params.store.handovers)
    .filter(
      (handover) =>
        handover.tenantId === params.tenantId &&
        handover.seatId === params.seat.seatId &&
        handover.status !== "completed" &&
        handover.outgoingEmployeeId.trim(),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return openHandover?.outgoingEmployeeId.trim() || null;
}

function memberHoldsAnotherSeat(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  employeeId: string;
}): boolean {
  for (const binding of Object.values(params.store.bindings)) {
    if (
      binding.tenantId === params.tenantId &&
      binding.employeeId === params.employeeId &&
      binding.seatId !== params.seatId &&
      binding.bindingStatus === "active"
    ) {
      return true;
    }
  }
  for (const seat of Object.values(params.store.seats)) {
    if (
      seat.tenantId === params.tenantId &&
      seat.seatId !== params.seatId &&
      seat.currentEmployeeId === params.employeeId
    ) {
      return true;
    }
  }
  return false;
}

function releaseSeatForPersonDeletion(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seat: EnterprisePositionSeat;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): void {
  for (const offer of Object.values(params.store.offers)) {
    if (
      offer.tenantId !== params.tenantId ||
      offer.seatId !== params.seat.seatId ||
      offer.status !== "pending"
    ) {
      continue;
    }
    cancelSeatAssignmentOffer({
      store: params.store,
      tenantId: params.tenantId,
      offerId: offer.offerId,
      nowIso: params.nowIso,
      actorEmployeeId: params.actorEmployeeId,
      auditId: params.auditId,
    });
  }
  for (const binding of Object.values(params.store.bindings)) {
    if (
      binding.tenantId !== params.tenantId ||
      binding.seatId !== params.seat.seatId ||
      binding.bindingStatus !== "active"
    ) {
      continue;
    }
    binding.bindingStatus = "revoked";
    binding.endedAt = params.nowIso;
    binding.endedReason = "offboarded";
  }
  for (const handover of Object.values(params.store.handovers)) {
    if (
      handover.tenantId !== params.tenantId ||
      handover.seatId !== params.seat.seatId ||
      handover.status === "completed"
    ) {
      continue;
    }
    handover.status = "completed";
    handover.completedAt = params.nowIso;
    handover.updatedAt = params.nowIso;
    handover.reviewSummary = "人岗同删：岗位与成员一并移除，交接已取消。";
  }
  params.seat.currentEmployeeId = undefined;
  params.seat.status = "vacant";
  params.seat.updatedAt = params.nowIso;
}

export function deleteSeatAndMember(params: {
  authStore: PlatformAuthStore;
  seatStore: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  actorUserId: string;
  nowIso: string;
  auditId?: string;
}): { teamLabel: string; employeeId: string } {
  const seat = params.seatStore.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    throw new Error("岗位不存在。");
  }
  const employeeId = resolveSeatMemberEmployeeId({
    store: params.seatStore,
    tenantId: params.tenantId,
    seat,
  });
  if (!employeeId) {
    throw new Error("该岗位没有在册成员，请使用删除岗位。");
  }
  if (employeeId === params.actorUserId) {
    throw new Error("不能注销自己的账号。");
  }
  if (
    memberHoldsAnotherSeat({
      store: params.seatStore,
      tenantId: params.tenantId,
      seatId: params.seatId,
      employeeId,
    })
  ) {
    throw new Error("该成员还绑定其他岗位，请先处理那些岗位后再人岗同删。");
  }
  const user = params.authStore.users[employeeId];
  const membership = user
    ? resolveMembershipSelectionForUser({
        store: params.authStore,
        userId: user.id,
        enterpriseId: params.tenantId,
      })
    : undefined;
  if (membership?.membershipRole === "enterprise-admin") {
    throw new Error("企业管理员不能通过人岗同删注销。");
  }
  const teamLabel = seat.teamLabel?.trim() || "未分组";
  releaseSeatForPersonDeletion({
    store: params.seatStore,
    tenantId: params.tenantId,
    seat,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorUserId,
    auditId: params.auditId,
  });
  revokeAccessPolicies({
    store: params.seatStore,
    tenantId: params.tenantId,
    employeeId,
    nowIso: params.nowIso,
  });
  revokeConnectorCredentialBindings({
    store: params.seatStore,
    tenantId: params.tenantId,
    ownerType: "employee",
    ownerId: employeeId,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorUserId,
    auditId: params.auditId,
    reason: "offboarded",
  });
  deleteVacantPositionSeat({
    store: params.seatStore,
    tenantId: params.tenantId,
    seatId: params.seatId,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorUserId,
    auditId: params.auditId,
  });
  if (user && membership && user.status !== "suspended") {
    applyEnterpriseMemberOffboard({
      store: params.authStore,
      user,
      membership,
      nowIso: params.nowIso,
    });
  }
  revokePendingEmployeeProvisionsForSeat({
    store: params.authStore,
    enterpriseId: params.tenantId,
    seatId: params.seatId,
    nowIso: params.nowIso,
    reason: "seat_deleted",
  });
  return { teamLabel, employeeId };
}
