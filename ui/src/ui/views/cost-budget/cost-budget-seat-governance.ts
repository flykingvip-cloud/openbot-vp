import type {
  AnalyticsResponse,
  RoleGrantProfileSummary,
  SeatAttributionResponse,
  SeatRole,
  SeatWithGrantSummary,
} from "../../capability/cost-budget-billing/index.ts";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import type { SeatsGovernanceDrilldownFocus } from "./cost-budget-drilldown.ts";
import { normalizeSeatAssignUserId } from "./cost-budget-seat-selection.ts";

export type SeatGovernanceMemberContext = {
  displayLabel: string;
  department: string;
  positionTitle: string;
};

export type SeatGovernanceRow = {
  seat: SeatWithGrantSummary;
  memberLabel: string;
  department: string;
  positionTitle: string;
  /** 套餐价目表全月单价（无 attribution 时展示）。 */
  catalogSeatPriceCents: number | null;
  usageQuantity: number;
  /** 本周期账单口径 Seat 成本（proration）。 */
  cycleSeatCostCents: number | null;
  /** 本周期账单口径 Usage 成本。 */
  cycleUsageCostCents: number | null;
  /** 本周期合计（Seat + Usage）。 */
  cycleTotalCostCents: number | null;
};

export type SeatGovernanceSummary = {
  viewerCount: number;
  creatorCount: number;
  adminCount: number;
  estimatedSeatMonthlyCents: number;
  cycleSeatCostCents: number | null;
  cycleUsageCostCents: number | null;
  cycleTotalCostCents: number | null;
};

export type UnassignedOrgMember = {
  userId: string;
  displayLabel: string;
  positionTitle: string | null;
  department: string | null;
};

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN", { sensitivity: "base" });
}

export function buildSeatGovernanceMemberContextMap(
  readModel: EnterprisePortReadModel | null | undefined,
): Map<string, SeatGovernanceMemberContext> {
  const map = new Map<string, SeatGovernanceMemberContext>();
  if (!readModel) {
    return map;
  }
  for (const member of readModel.memberSummaries) {
    const key = normalizeSeatAssignUserId(member.user);
    if (!key) {
      continue;
    }
    map.set(key, {
      displayLabel: member.displayLabel.trim() || member.user,
      department: member.seatTeamLabel?.trim() || "未分组",
      positionTitle: member.seatTitle?.trim() || "—",
    });
  }
  return map;
}

export function buildSeatAttributionByBillingSeatId(
  attribution: SeatAttributionResponse | null | undefined,
): Map<string, SeatAttributionResponse["rows"][number]> {
  const map = new Map<string, SeatAttributionResponse["rows"][number]>();
  if (!attribution?.subscribed) {
    return map;
  }
  for (const row of attribution.rows) {
    map.set(row.billingSeatId, row);
  }
  return map;
}

export function buildSeatAttributionByUserId(
  attribution: SeatAttributionResponse | null | undefined,
): Map<string, SeatAttributionResponse["rows"][number]> {
  const map = new Map<string, SeatAttributionResponse["rows"][number]>();
  if (!attribution?.subscribed) {
    return map;
  }
  for (const row of attribution.rows) {
    map.set(normalizeSeatAssignUserId(row.userId), row);
  }
  return map;
}

export function resolveRoleSeatPriceCents(
  role: SeatRole,
  roleProfiles: ReadonlyArray<RoleGrantProfileSummary>,
): number | null {
  return roleProfiles.find((profile) => profile.role === role)?.seatPriceCents ?? null;
}

export function resolveMemberUsageQuantity(
  userId: string,
  analytics: AnalyticsResponse | null | undefined,
  attribution: SeatAttributionResponse | null | undefined,
): number {
  const attributed = buildSeatAttributionByUserId(attribution).get(
    normalizeSeatAssignUserId(userId),
  );
  if (attributed) {
    return attributed.usageQuantity;
  }
  if (!analytics?.byUser) {
    return 0;
  }
  const direct = analytics.byUser[userId];
  if (typeof direct === "number") {
    return direct;
  }
  const normalized = normalizeSeatAssignUserId(userId);
  for (const [key, quantity] of Object.entries(analytics.byUser)) {
    if (normalizeSeatAssignUserId(key) === normalized) {
      return quantity;
    }
  }
  return 0;
}

export function buildSeatGovernanceRows(params: {
  seats: ReadonlyArray<SeatWithGrantSummary>;
  readModel: EnterprisePortReadModel | null | undefined;
  roleProfiles: ReadonlyArray<RoleGrantProfileSummary>;
  analytics: AnalyticsResponse | null | undefined;
  attribution: SeatAttributionResponse | null | undefined;
}): SeatGovernanceRow[] {
  const memberContext = buildSeatGovernanceMemberContextMap(params.readModel);
  const attributionBySeatId = buildSeatAttributionByBillingSeatId(params.attribution);
  const rows = params.seats.map((seat) => {
    const context = memberContext.get(normalizeSeatAssignUserId(seat.userId));
    const memberLabel = context?.displayLabel ?? seat.userId;
    const department = context?.department ?? "未分组";
    const positionTitle = context?.positionTitle ?? "—";
    const attributed = attributionBySeatId.get(seat.id);
    const hasAttribution = params.attribution?.subscribed === true;
    return {
      seat,
      memberLabel,
      department,
      positionTitle,
      catalogSeatPriceCents: resolveRoleSeatPriceCents(seat.currentRole, params.roleProfiles),
      usageQuantity: resolveMemberUsageQuantity(seat.userId, params.analytics, params.attribution),
      cycleSeatCostCents: hasAttribution ? (attributed?.seatCostCents ?? 0) : null,
      cycleUsageCostCents: hasAttribution ? (attributed?.usageCostCents ?? 0) : null,
      cycleTotalCostCents: hasAttribution ? (attributed?.totalCostCents ?? 0) : null,
    };
  });
  return rows.toSorted((left, right) => {
    const byDepartment = compareText(left.department, right.department);
    if (byDepartment !== 0) {
      return byDepartment;
    }
    const byPosition = compareText(left.positionTitle, right.positionTitle);
    if (byPosition !== 0) {
      return byPosition;
    }
    return compareText(left.memberLabel, right.memberLabel);
  });
}

export function sortSeatGovernanceRowsForDrilldown(
  rows: ReadonlyArray<SeatGovernanceRow>,
  focus: SeatsGovernanceDrilldownFocus | null | undefined,
): SeatGovernanceRow[] {
  if (!focus) {
    return [...rows];
  }
  const copy = [...rows];
  copy.sort((left, right) => {
    const pick = (row: SeatGovernanceRow): number => {
      switch (focus) {
        case "seat":
          return row.cycleSeatCostCents ?? 0;
        case "usage":
          return row.cycleUsageCostCents ?? 0;
        case "total":
          return row.cycleTotalCostCents ?? 0;
      }
    };
    const delta = pick(right) - pick(left);
    if (delta !== 0) {
      return delta;
    }
    return compareText(left.memberLabel, right.memberLabel);
  });
  return copy;
}

export function buildSeatGovernanceSummary(
  rows: ReadonlyArray<SeatGovernanceRow>,
  attribution: SeatAttributionResponse | null | undefined,
): SeatGovernanceSummary {
  let viewerCount = 0;
  let creatorCount = 0;
  let adminCount = 0;
  let estimatedSeatMonthlyCents = 0;
  for (const row of rows) {
    switch (row.seat.currentRole) {
      case "viewer":
        viewerCount += 1;
        break;
      case "creator":
        creatorCount += 1;
        break;
      case "admin":
        adminCount += 1;
        break;
    }
    if (row.catalogSeatPriceCents != null) {
      estimatedSeatMonthlyCents += row.catalogSeatPriceCents;
    }
  }
  const hasAttribution = attribution?.subscribed === true;
  return {
    viewerCount,
    creatorCount,
    adminCount,
    estimatedSeatMonthlyCents,
    cycleSeatCostCents: hasAttribution ? attribution.summary.seatCostCents : null,
    cycleUsageCostCents: hasAttribution ? attribution.summary.usageCostCents : null,
    cycleTotalCostCents: hasAttribution ? attribution.summary.totalCostCents : null,
  };
}

export function listUnassignedOrgMembers(
  readModel: EnterprisePortReadModel | null | undefined,
  assignedSeatUserIds: ReadonlySet<string>,
): UnassignedOrgMember[] {
  if (!readModel) {
    return [];
  }
  return readModel.memberSummaries
    .filter(
      (member) =>
        member.status === "active" &&
        member.seatTitle?.trim() &&
        !assignedSeatUserIds.has(normalizeSeatAssignUserId(member.user)),
    )
    .map((member) => ({
      userId: member.user,
      displayLabel: member.displayLabel.trim() || member.user,
      positionTitle: member.seatTitle,
      department: member.seatTeamLabel,
    }))
    .toSorted((left, right) => {
      const byDepartment = compareText(left.department ?? "", right.department ?? "");
      if (byDepartment !== 0) {
        return byDepartment;
      }
      return compareText(left.positionTitle ?? "", right.positionTitle ?? "");
    });
}
