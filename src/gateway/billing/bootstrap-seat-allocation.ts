/**
 * 订阅开通后：按已构建的企业组织自动分配计费席位并应用套餐默认模型档案。
 *
 * 避免「套餐已订阅但无人有 billing seat / model grant → 终端员工无法使用 AI」。
 */

import { loadConfig } from "../../config/config.js";
import {
  loadEnterpriseSeatAssetsStore,
  type EnterprisePositionSeat,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { applyRoleGrantProfileForSeat } from "../model-entitlement/apply-role-grant-profile.js";
import { mirrorBillingGrantToOrgSeats } from "../model-entitlement/mirror-billing-grant-to-org-seats.js";
import { resolvePlatformAuthConfig } from "../platform-auth/config.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import { loadPlatformAuthStore } from "../platform-auth/store.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { billingEventBus } from "./event-bus.js";
import { getPlanVersion } from "./plans-store.js";
import {
  assignDefaultSeatEntitlementProfile,
  upsertSeatEntitlementAssignment,
} from "./seat-entitlement-assignments-store.js";
import { resolveSeatRoleFromRoleCode } from "./seat-role-prefix-rules.js";
import { assignSeat, countSeatsByRole, findBillingSeatByUserId, listSeats } from "./seats-store.js";
import { countActiveBillingSeats, resolveTrialSeatCapacity } from "./trial-seat-capacity.js";
import type { SeatRole } from "./types.js";

export type SeatBootstrapAssignResult = {
  userEmail: string;
  role: SeatRole;
  seatId: string;
  modelCount: number;
  source: "org_position" | "membership";
};

export type SeatBootstrapSkipResult = {
  userEmail: string;
  reason: string;
};

export type SeatBootstrapResult = {
  /** 企业是否已具备可推断成员的组织/成员目录。 */
  orgReady: boolean;
  orgSeatCount: number;
  memberCandidates: number;
  assigned: number;
  skipped: number;
  results: SeatBootstrapAssignResult[];
  skippedDetails: SeatBootstrapSkipResult[];
};

type BootstrapCandidate = {
  userEmail: string;
  platformUserId: string;
  role: SeatRole;
  source: "org_position" | "membership";
};

function tenantKey(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function listOrgSeatsForTenant(
  seatStore: EnterpriseSeatAssetsStore,
  enterpriseId: string,
): EnterprisePositionSeat[] {
  const canonical = tenantKey(enterpriseId);
  return Object.values(seatStore.seats).filter(
    (seat) => (canonicalizeTenantId(seat.tenantId) ?? seat.tenantId) === canonical,
  );
}

function resolveOrgSeatForPlatformUser(
  orgSeats: EnterprisePositionSeat[],
  seatStore: EnterpriseSeatAssetsStore,
  platformUserId: string,
): EnterprisePositionSeat | null {
  const direct = orgSeats.find((seat) => seat.currentEmployeeId === platformUserId);
  if (direct) {
    return direct;
  }
  for (const seat of orgSeats) {
    const binding = Object.values(seatStore.bindings).find(
      (entry) =>
        entry.seatId === seat.seatId &&
        entry.bindingStatus === "active" &&
        entry.employeeId === platformUserId,
    );
    if (binding) {
      return seat;
    }
  }
  return null;
}

function resolveRoleForMember(params: {
  membershipRole: string;
  orgSeat: EnterprisePositionSeat | null;
}): SeatRole {
  if (params.orgSeat?.roleCode?.trim()) {
    return resolveSeatRoleFromRoleCode(params.orgSeat.roleCode);
  }
  if (params.membershipRole === "enterprise-admin") {
    return "admin";
  }
  return "viewer";
}

function collectCandidatesFromPlatformAuth(params: {
  store: PlatformAuthStore;
  seatStore: EnterpriseSeatAssetsStore;
  enterpriseId: string;
}): BootstrapCandidate[] {
  const canonical = tenantKey(params.enterpriseId);
  const orgSeats = listOrgSeatsForTenant(params.seatStore, params.enterpriseId);
  const candidates: BootstrapCandidate[] = [];
  const seen = new Set<string>();

  for (const membership of Object.values(params.store.memberships)) {
    if ((canonicalizeTenantId(membership.enterpriseId) ?? membership.enterpriseId) !== canonical) {
      continue;
    }
    const user = params.store.users[membership.userId];
    const email = user?.email?.trim();
    if (!email || user?.status === "suspended") {
      continue;
    }
    const key = normalizeEmail(email);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const orgSeat = resolveOrgSeatForPlatformUser(orgSeats, params.seatStore, membership.userId);
    candidates.push({
      userEmail: email,
      platformUserId: membership.userId,
      role: resolveRoleForMember({
        membershipRole: membership.membershipRole,
        orgSeat,
      }),
      source: orgSeat ? "org_position" : "membership",
    });
  }
  return candidates;
}

function collectCandidatesFromOrgSeatsOnly(params: {
  seatStore: EnterpriseSeatAssetsStore;
  enterpriseId: string;
  authStore: PlatformAuthStore | null;
}): BootstrapCandidate[] {
  const orgSeats = listOrgSeatsForTenant(params.seatStore, params.enterpriseId);
  const candidates: BootstrapCandidate[] = [];
  const seen = new Set<string>();

  for (const orgSeat of orgSeats) {
    const employeeId = orgSeat.currentEmployeeId?.trim();
    if (!employeeId) {
      continue;
    }
    const user = params.authStore?.users[employeeId];
    const email = user?.email?.trim();
    if (!email) {
      continue;
    }
    const key = normalizeEmail(email);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push({
      userEmail: email,
      platformUserId: employeeId,
      role: resolveSeatRoleFromRoleCode(orgSeat.roleCode),
      source: "org_position",
    });
  }
  return candidates;
}

async function canAssignRole(
  enterpriseId: string,
  planVersionId: string,
  role: SeatRole,
  seatsStorePath?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trialCap = await resolveTrialSeatCapacity(enterpriseId);
  if (trialCap != null) {
    const active = await countActiveBillingSeats(enterpriseId, seatsStorePath);
    if (active >= trialCap) {
      return { ok: false, reason: `试用席位已满（上限 ${trialCap}）` };
    }
    return { ok: true };
  }
  const version = await getPlanVersion(planVersionId);
  const quota = version?.snapshot.seatQuota?.[role];
  if (typeof quota !== "number") {
    return { ok: true };
  }
  const counts = await countSeatsByRole(enterpriseId, seatsStorePath);
  if ((counts[role] ?? 0) >= quota) {
    return { ok: false, reason: `角色 ${role} 席位配额已满（上限 ${quota}）` };
  }
  return { ok: true };
}

export async function bootstrapBillingSeatsFromOrganization(params: {
  enterpriseId: string;
  planVersionId: string;
  actorUserId?: string;
  seatsStorePath?: string;
  seatAssetsStorePath?: string;
  entitlementStorePath?: string;
  seatGrantStorePath?: string;
  platformAuthStorePath?: string;
}): Promise<SeatBootstrapResult> {
  const seatStore = params.seatAssetsStorePath
    ? await loadEnterpriseSeatAssetsStore(params.seatAssetsStorePath)
    : await loadSeatAssetsStoreForTenantId(params.enterpriseId);
  const orgSeats = listOrgSeatsForTenant(seatStore, params.enterpriseId);

  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  const authStore = authConfig?.enabled
    ? await loadPlatformAuthStore(
        params.platformAuthStorePath
          ? { ...authConfig, storePath: params.platformAuthStorePath }
          : authConfig,
      )
    : null;

  let candidates: BootstrapCandidate[] = [];
  if (authStore) {
    candidates = collectCandidatesFromPlatformAuth({
      store: authStore,
      seatStore,
      enterpriseId: params.enterpriseId,
    });
  }
  if (candidates.length === 0) {
    candidates = collectCandidatesFromOrgSeatsOnly({
      seatStore,
      enterpriseId: params.enterpriseId,
      authStore,
    });
  }

  const orgReady = orgSeats.length > 0 || candidates.length > 0;
  const result: SeatBootstrapResult = {
    orgReady,
    orgSeatCount: orgSeats.length,
    memberCandidates: candidates.length,
    assigned: 0,
    skipped: 0,
    results: [],
    skippedDetails: [],
  };

  if (candidates.length === 0) {
    return result;
  }

  const existingSeats = await listSeats(params.enterpriseId, params.seatsStorePath, {
    status: "active",
  });
  const assignedEmails = new Set(existingSeats.map((seat) => normalizeEmail(seat.userId)));
  const trialCap = await resolveTrialSeatCapacity(params.enterpriseId);

  for (const candidate of candidates) {
    const emailKey = normalizeEmail(candidate.userEmail);
    if (assignedEmails.has(emailKey)) {
      const existing = await findBillingSeatByUserId(
        params.enterpriseId,
        candidate.userEmail,
        params.seatsStorePath,
      );
      if (existing) {
        const grantResult = await applyRoleGrantProfileForSeat({
          tenantId: params.enterpriseId,
          seatId: existing.id,
          role: existing.currentRole,
          ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
          ...(params.entitlementStorePath
            ? { entitlementStorePath: params.entitlementStorePath }
            : {}),
          ...(params.seatGrantStorePath ? { seatGrantStorePath: params.seatGrantStorePath } : {}),
        });
        if (grantResult.applied && grantResult.grant) {
          await mirrorBillingGrantToOrgSeats({
            tenantId: params.enterpriseId,
            userId: candidate.userEmail,
            grant: grantResult.grant,
            ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
          });
        }
      }
      result.skipped += 1;
      result.skippedDetails.push({
        userEmail: candidate.userEmail,
        reason: "已分配计费席位",
      });
      continue;
    }

    const quotaCheck = await canAssignRole(
      params.enterpriseId,
      params.planVersionId,
      candidate.role,
      params.seatsStorePath,
    );
    if (!quotaCheck.ok) {
      result.skipped += 1;
      result.skippedDetails.push({
        userEmail: candidate.userEmail,
        reason: quotaCheck.reason,
      });
      continue;
    }

    const seat = await assignSeat(
      {
        enterpriseId: params.enterpriseId,
        userId: candidate.userEmail,
        role: candidate.role,
        botQuota: 0,
      },
      params.seatsStorePath,
    );
    if (trialCap != null) {
      await upsertSeatEntitlementAssignment({
        enterpriseId: params.enterpriseId,
        seatId: seat.id,
        profileId: "basic_ai",
      });
    } else {
      await assignDefaultSeatEntitlementProfile({
        enterpriseId: params.enterpriseId,
        seatId: seat.id,
        role: candidate.role,
      });
    }
    assignedEmails.add(emailKey);

    await billingEventBus.publish({
      type: "seat.changed",
      enterpriseId: params.enterpriseId,
      seatId: seat.id,
      fromRole: null,
      toRole: candidate.role,
      effectiveAt: seat.createdAt,
    });

    const grantResult = await applyRoleGrantProfileForSeat({
      tenantId: params.enterpriseId,
      seatId: seat.id,
      role: candidate.role,
      ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      ...(params.entitlementStorePath ? { entitlementStorePath: params.entitlementStorePath } : {}),
      ...(params.seatGrantStorePath ? { seatGrantStorePath: params.seatGrantStorePath } : {}),
    });
    if (grantResult.applied && grantResult.grant) {
      await mirrorBillingGrantToOrgSeats({
        tenantId: params.enterpriseId,
        userId: candidate.userEmail,
        grant: grantResult.grant,
        ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      });
    }

    result.assigned += 1;
    result.results.push({
      userEmail: candidate.userEmail,
      role: candidate.role,
      seatId: seat.id,
      modelCount: grantResult.profile?.modelCount ?? 0,
      source: candidate.source,
    });
  }

  return result;
}
