import type { SeatRole, SeatWithGrantSummary } from "../../capability/cost-budget-billing/index.ts";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import { normalizeSeatAssignUserId } from "./cost-budget-seat-selection.ts";

export type SeatRoleTemplateStore = {
  /** roleCode 首段前缀 → 默认档位，如 SALES → creator */
  prefixRules: Record<string, SeatRole>;
  /** 组织岗位 seatId → 默认档位（覆盖前缀规则） */
  positionOverrides: Record<string, SeatRole>;
};

const STORAGE_KEY_PREFIX = "openbot.cost-budget.seatRoleTemplates.";

/** 内置前缀规则（可被企业自定义覆盖）。 */
export const BUILTIN_SEAT_ROLE_PREFIX_RULES: Record<string, SeatRole> = {
  MGR: "admin",
  MANAGER: "admin",
  ADMIN: "admin",
  DIRECTOR: "admin",
  LEAD: "creator",
  SALES: "creator",
  CS: "creator",
  OPS: "creator",
  DEV: "creator",
  ENG: "creator",
  FIN: "viewer",
  HR: "viewer",
  VIEW: "viewer",
};

const ROLE_RANK: Record<SeatRole, number> = {
  viewer: 0,
  creator: 1,
  admin: 2,
};

export function extractRoleCodePrefix(roleCode: string | null | undefined): string | null {
  const normalized = roleCode?.trim();
  if (!normalized) {
    return null;
  }
  const segment = normalized.split("-")[0]?.trim();
  return segment ? segment.toUpperCase() : null;
}

export function loadSeatRoleTemplateStore(tenantId: string): SeatRoleTemplateStore {
  if (typeof localStorage === "undefined") {
    return { prefixRules: {}, positionOverrides: {} };
  }
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tenantId}`);
    if (!raw) {
      return { prefixRules: {}, positionOverrides: {} };
    }
    const parsed = JSON.parse(raw) as Partial<SeatRoleTemplateStore>;
    return {
      prefixRules: parsed.prefixRules ?? {},
      positionOverrides: parsed.positionOverrides ?? {},
    };
  } catch {
    return { prefixRules: {}, positionOverrides: {} };
  }
}

export function saveSeatRoleTemplateStore(tenantId: string, store: SeatRoleTemplateStore): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${tenantId}`, JSON.stringify(store));
}

export function listDistinctRoleCodePrefixes(
  readModel: EnterprisePortReadModel | null | undefined,
): string[] {
  if (!readModel) {
    return [];
  }
  const prefixes = new Set<string>();
  for (const seat of readModel.seatSummaries) {
    const prefix = extractRoleCodePrefix(seat.roleCode);
    if (prefix) {
      prefixes.add(prefix);
    }
  }
  return [...prefixes].toSorted((left, right) => left.localeCompare(right, "zh-CN"));
}

export function resolveSuggestedSeatRole(params: {
  orgSeatId?: string | null;
  roleCode?: string | null;
  templates: SeatRoleTemplateStore;
}): SeatRole {
  const orgSeatId = params.orgSeatId?.trim();
  if (orgSeatId && params.templates.positionOverrides[orgSeatId]) {
    return params.templates.positionOverrides[orgSeatId];
  }
  const prefix = extractRoleCodePrefix(params.roleCode);
  if (prefix) {
    if (params.templates.prefixRules[prefix]) {
      return params.templates.prefixRules[prefix];
    }
    if (BUILTIN_SEAT_ROLE_PREFIX_RULES[prefix]) {
      return BUILTIN_SEAT_ROLE_PREFIX_RULES[prefix];
    }
  }
  return "viewer";
}

export function buildBillingRoleByUserId(
  seats: ReadonlyArray<Pick<SeatWithGrantSummary, "userId" | "currentRole">>,
): Map<string, SeatRole> {
  const map = new Map<string, SeatRole>();
  for (const seat of seats) {
    map.set(normalizeSeatAssignUserId(seat.userId), seat.currentRole);
  }
  return map;
}

export function buildOrgSeatMetaById(
  readModel: EnterprisePortReadModel | null | undefined,
): Map<string, { roleCode: string | null; seatTitle: string }> {
  const map = new Map<string, { roleCode: string | null; seatTitle: string }>();
  if (!readModel) {
    return map;
  }
  for (const seat of readModel.seatSummaries) {
    map.set(seat.seatId, {
      roleCode: seat.roleCode?.trim() || null,
      seatTitle: seat.title.trim(),
    });
  }
  return map;
}

export function resolveUserOrgSeatId(
  userId: string,
  readModel: EnterprisePortReadModel | null | undefined,
): string | null {
  if (!readModel) {
    return null;
  }
  const member = readModel.memberSummaries.find(
    (entry) => normalizeSeatAssignUserId(entry.user) === normalizeSeatAssignUserId(userId),
  );
  if (!member?.seatTitle?.trim()) {
    return null;
  }
  const title = member.seatTitle.trim();
  const team = member.seatTeamLabel?.trim() || null;
  const matches = readModel.seatSummaries.filter((seat) => {
    if (seat.title.trim() !== title) {
      return false;
    }
    if (!team) {
      return true;
    }
    return (seat.teamLabel?.trim() || "未分组") === team;
  });
  return matches.length === 1 ? (matches[0]?.seatId ?? null) : null;
}

export function resolveSuggestedRoleForUser(params: {
  userId: string;
  readModel: EnterprisePortReadModel | null | undefined;
  templates: SeatRoleTemplateStore;
}): SeatRole {
  const orgSeatId = resolveUserOrgSeatId(params.userId, params.readModel);
  const orgSeat = orgSeatId
    ? params.readModel?.seatSummaries.find((seat) => seat.seatId === orgSeatId)
    : null;
  return resolveSuggestedSeatRole({
    orgSeatId,
    roleCode: orgSeat?.roleCode ?? null,
    templates: params.templates,
  });
}

/** 多选成员时取建议档位的「最高档」以便批量分配可覆盖多数人。 */
export function resolveAggregatedSuggestedRole(params: {
  userIds: ReadonlyArray<string>;
  readModel: EnterprisePortReadModel | null | undefined;
  templates: SeatRoleTemplateStore;
}): SeatRole {
  if (params.userIds.length === 0) {
    return "viewer";
  }
  let highest: SeatRole = "viewer";
  for (const userId of params.userIds) {
    const suggested = resolveSuggestedRoleForUser({
      userId,
      readModel: params.readModel,
      templates: params.templates,
    });
    if (ROLE_RANK[suggested] > ROLE_RANK[highest]) {
      highest = suggested;
    }
  }
  return highest;
}

export function buildSuggestedRoleByOrgSeatId(params: {
  readModel: EnterprisePortReadModel | null | undefined;
  templates: SeatRoleTemplateStore;
  billingRoleByUserId: ReadonlyMap<string, SeatRole>;
}): Map<string, SeatRole> {
  const map = new Map<string, SeatRole>();
  if (!params.readModel) {
    return map;
  }
  for (const seat of params.readModel.seatSummaries) {
    const occupant = seat.currentEmployeeUser?.trim();
    const billingRole = occupant
      ? params.billingRoleByUserId.get(normalizeSeatAssignUserId(occupant))
      : undefined;
    if (billingRole) {
      map.set(seat.seatId, billingRole);
      continue;
    }
    map.set(
      seat.seatId,
      resolveSuggestedSeatRole({
        orgSeatId: seat.seatId,
        roleCode: seat.roleCode,
        templates: params.templates,
      }),
    );
  }
  return map;
}

export function seatRoleShortLabel(role: SeatRole): string {
  switch (role) {
    case "viewer":
      return "只读";
    case "creator":
      return "创作";
    case "admin":
      return "管理";
  }
}
