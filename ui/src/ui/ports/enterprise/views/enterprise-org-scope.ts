import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import type { EnterpriseOrgDepartmentNode } from "./enterprise-org-tree-model.ts";

export function resolveOrganizationDepartmentScope(
  readModel: EnterprisePortReadModel,
): string | null {
  if (readModel.membershipRole === "enterprise-admin") {
    return null;
  }
  const user = readModel.authenticatedUser?.trim();
  if (!user) {
    return null;
  }
  const member = readModel.memberSummaries.find((entry) => entry.user === user);
  const seatTitle = member?.seatTitle?.trim();
  if (!seatTitle) {
    return null;
  }
  const seat = readModel.seatSummaries.find((entry) => entry.title === seatTitle);
  const teamLabel = seat?.teamLabel?.trim() ?? member?.seatTeamLabel?.trim();
  if (!teamLabel || teamLabel === "未分组") {
    return null;
  }
  return teamLabel;
}

export function organizationRowVisibleUnderScope(
  teamLabel: string | null | undefined,
  scopePath: string | null,
): boolean {
  if (!scopePath) {
    return true;
  }
  const normalized = teamLabel?.trim() || "未分组";
  return (
    normalized === scopePath ||
    normalized.startsWith(`${scopePath}/`) ||
    scopePath.startsWith(`${normalized}/`)
  );
}

function departmentVisibleInScope(departmentPath: string, scopePath: string): boolean {
  return (
    departmentPath === scopePath ||
    scopePath.startsWith(`${departmentPath}/`) ||
    departmentPath.startsWith(`${scopePath}/`)
  );
}

function filterDepartmentNodeByScope(
  department: EnterpriseOrgDepartmentNode,
  scopePath: string,
): EnterpriseOrgDepartmentNode | null {
  if (!departmentVisibleInScope(department.fullPath, scopePath)) {
    return null;
  }
  const scopedChildren = department.childDepartments
    .map((child) => filterDepartmentNodeByScope(child, scopePath))
    .filter((child): child is EnterpriseOrgDepartmentNode => child !== null);
  const positions =
    department.fullPath === scopePath || scopePath.startsWith(`${department.fullPath}/`)
      ? department.positions.filter((position) =>
          organizationRowVisibleUnderScope(position.teamLabel, scopePath),
        )
      : [];
  if (
    scopedChildren.length === 0 &&
    positions.length === 0 &&
    department.fullPath !== scopePath &&
    !scopePath.startsWith(`${department.fullPath}/`)
  ) {
    return null;
  }
  return {
    ...department,
    childDepartments: scopedChildren,
    positions,
  };
}

export function filterEnterpriseOrgDepartmentsByScope(
  departments: EnterpriseOrgDepartmentNode[],
  scopePath: string | null,
): EnterpriseOrgDepartmentNode[] {
  if (!scopePath) {
    return departments;
  }
  return departments
    .map((department) => filterDepartmentNodeByScope(department, scopePath))
    .filter((department): department is EnterpriseOrgDepartmentNode => department !== null);
}

export function organizationScopeBlocksDepartmentManagement(scopePath: string | null): boolean {
  return scopePath !== null;
}
