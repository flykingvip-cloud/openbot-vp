// Enterprise Data Capability Center — org target picker source.
//
// Authorization policies + capability seat grants target the enterprise org
// (seat / department / role). The authoritative org data lives in the
// EnterpriseSeatAssetsStore (cross-store), so this resolver reads seats from
// there and derives the selectable targets:
//   - seats:       one entry per tenant seat (authoritative seatId + title).
//   - departments: distinct `roleCode:teamLabel` (matches the seed/authorization
//                  card convention, e.g. `sales-mgr:华东销售`).
//   - roles:       distinct roleCode.
// Department/role are not first-class org entities yet (spec decision a); they
// are derived from seat.roleCode + seat.teamLabel for selection convenience.

import {
  listTenantSeats,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";

export type OrgSeatTarget = {
  seatId: string;
  title: string;
  teamLabel?: string;
  roleCode?: string;
  status: string;
};

export type OrgDepartmentTarget = {
  /** Synthetic id `roleCode:teamLabel`, used as the policy targetId. */
  departmentId: string;
  /** Human label (team name). */
  label: string;
  seatCount: number;
};

export type OrgRoleTarget = {
  roleCode: string;
  seatCount: number;
};

export type OrgTargets = {
  seats: OrgSeatTarget[];
  departments: OrgDepartmentTarget[];
  roles: OrgRoleTarget[];
};

export function resolveOrgTargets(params: {
  seatStore: EnterpriseSeatAssetsStore;
  tenantId: string;
}): OrgTargets {
  const seats = listTenantSeats(params.seatStore, params.tenantId);
  const seatTargets: OrgSeatTarget[] = seats
    .map((seat) => ({
      seatId: seat.seatId,
      title: seat.title,
      teamLabel: seat.teamLabel,
      roleCode: seat.roleCode,
      status: seat.status,
    }))
    .toSorted((left, right) => left.title.localeCompare(right.title));

  const departmentMap = new Map<string, OrgDepartmentTarget>();
  const roleMap = new Map<string, OrgRoleTarget>();
  for (const seat of seats) {
    const roleCode = seat.roleCode?.trim();
    const teamLabel = seat.teamLabel?.trim();
    if (roleCode && teamLabel) {
      const departmentId = `${roleCode}:${teamLabel}`;
      const existing = departmentMap.get(departmentId) ?? {
        departmentId,
        label: teamLabel,
        seatCount: 0,
      };
      existing.seatCount += 1;
      departmentMap.set(departmentId, existing);
    }
    if (roleCode) {
      const existing = roleMap.get(roleCode) ?? { roleCode, seatCount: 0 };
      existing.seatCount += 1;
      roleMap.set(roleCode, existing);
    }
  }

  return {
    seats: seatTargets,
    departments: [...departmentMap.values()].toSorted((left, right) =>
      left.label.localeCompare(right.label),
    ),
    roles: [...roleMap.values()].toSorted((left, right) =>
      left.roleCode.localeCompare(right.roleCode),
    ),
  };
}

/** Set of authoritative seat ids for a tenant — used to validate policy seat targets. */
export function resolveTenantSeatIdSet(params: {
  seatStore: EnterpriseSeatAssetsStore;
  tenantId: string;
}): Set<string> {
  return new Set(listTenantSeats(params.seatStore, params.tenantId).map((seat) => seat.seatId));
}
