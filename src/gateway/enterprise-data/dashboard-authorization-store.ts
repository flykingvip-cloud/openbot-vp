// Enterprise Data Capability Center — data authorization cards aggregator.
// Spec: .kiro/specs/enterprise-data-capability-center/tasks.md (Task 2.1, decision (b) v1)
//
// v1 scope (decision b): per DataSource, expand SEAT targets (authoritative title via
// EnterpriseSeatAssetsStore) and ROLE targets (grouped by roleCode, count = #seats with
// that roleCode, marked non-precise). DEPARTMENT targets are NOT expanded into counts in
// v1 (no first-class department entity yet — decision (a) is a follow-up); we only surface
// how many department-kind policies exist so the UI can disclose them honestly.

import {
  listTenantSeats,
  type EnterprisePositionSeat,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { listDataAccessPolicies } from "./data-access-policy-store.js";
import { listDataSources } from "./data-source-store.js";
import type { EnterpriseDataStore } from "./types.js";

export type AuthorizationTargetView = {
  kind: "seat" | "role" | "department";
  /** seat: seat title (authoritative) or raw seatId fallback; role/department: resolved label. */
  label: string;
  /** seat: 1; role/department: matched seat count. */
  count: number;
  /** true when label/count come from authoritative seat mapping; false for grouped/fallback values. */
  precise: boolean;
};

export type DataAuthorizationSourceCard = {
  sourceId: string;
  displayName: string;
  targets: AuthorizationTargetView[];
};

type ResolvedDepartmentTarget = {
  label: string;
  count: number;
  precise: boolean;
};

function matchRoleCode(seat: EnterprisePositionSeat, roleTargetId: string): boolean {
  const roleCode = seat.roleCode?.trim().toLowerCase();
  if (!roleCode) {
    return false;
  }
  const normalizedTarget = roleTargetId.trim().toLowerCase();
  return roleCode === normalizedTarget || roleCode.startsWith(`${normalizedTarget}-`);
}

function resolveDepartmentTarget(
  seats: EnterprisePositionSeat[],
  departmentTargetId: string,
): ResolvedDepartmentTarget {
  const normalized = departmentTargetId.trim();
  if (!normalized) {
    return { label: departmentTargetId, count: 0, precise: false };
  }
  const [rawRoleCode, ...teamParts] = normalized.split(":");
  const teamLabel = teamParts.join(":").trim();
  const roleCode = rawRoleCode.trim();
  const matchedSeats = seats.filter((seat) => {
    const sameTeam = teamLabel ? seat.teamLabel?.trim() === teamLabel : true;
    const sameRole = roleCode ? matchRoleCode(seat, roleCode) : true;
    return sameTeam && sameRole;
  });
  const label = teamLabel || roleCode || departmentTargetId;
  return {
    label,
    count: matchedSeats.length,
    precise: Boolean(teamLabel) && matchedSeats.length > 0,
  };
}

export function resolveDataAuthorizationCards(params: {
  store: EnterpriseDataStore;
  seatStore: EnterpriseSeatAssetsStore;
  tenantId: string;
}): DataAuthorizationSourceCard[] {
  const { store, seatStore, tenantId } = params;

  const seats = listTenantSeats(seatStore, tenantId);
  const seatById = new Map(seats.map((seat) => [seat.seatId, seat] as const));
  const roleCount = new Map<string, number>();
  for (const seat of seats) {
    if (seat.roleCode) {
      roleCount.set(seat.roleCode, (roleCount.get(seat.roleCode) ?? 0) + 1);
    }
  }

  const sources = listDataSources({ store, tenantId });
  const policies = listDataAccessPolicies({ store, tenantId });

  return sources.map((source) => {
    const sourcePolicies = policies.filter((policy) => policy.sourceId === source.sourceId);

    const seatTargetIds = new Set<string>();
    const roleTargetIds = new Set<string>();
    const departmentTargetIds = new Set<string>();

    for (const policy of sourcePolicies) {
      if (policy.targetKind === "seat") {
        seatTargetIds.add(policy.targetId);
      } else if (policy.targetKind === "role") {
        roleTargetIds.add(policy.targetId);
      } else if (policy.targetKind === "department") {
        departmentTargetIds.add(policy.targetId);
      }
    }

    const seatTargets: AuthorizationTargetView[] = [...seatTargetIds].map((seatId) => {
      const seat = seatById.get(seatId);
      return {
        kind: "seat",
        label: seat?.title ?? seatId,
        count: 1,
        precise: seat != null,
      };
    });

    const roleTargets: AuthorizationTargetView[] = [...roleTargetIds].map((roleCode) => ({
      kind: "role",
      label: roleCode,
      count: roleCount.get(roleCode) ?? 0,
      precise: false,
    }));

    const departmentTargets: AuthorizationTargetView[] = [...departmentTargetIds].map(
      (departmentTargetId) => {
        const resolved = resolveDepartmentTarget(seats, departmentTargetId);
        return {
          kind: "department",
          label: resolved.label,
          count: resolved.count,
          precise: resolved.precise,
        };
      },
    );

    const targets = [...seatTargets, ...roleTargets, ...departmentTargets].toSorted((left, right) =>
      left.label.localeCompare(right.label),
    );

    return {
      sourceId: source.sourceId,
      displayName: source.displayName,
      targets,
    };
  });
}
