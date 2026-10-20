import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  buildOrderedChildren,
  mergeOrganizationChildOrderKeys,
  organizationChildDepartmentKey,
  type EnterpriseOrgChildNode,
} from "./enterprise-org-child-order.ts";
import {
  matchesOrganizationTeamPath,
  organizationPathKey,
  resolveOrganizationFullPath,
  splitOrganizationPath,
} from "./enterprise-org-path.ts";

export type EnterpriseOrgMemberNode = {
  kind: "member";
  user: string;
  displayLabel: string;
  membershipRole: string;
  status: string;
};

export type EnterpriseOrgPositionNode = {
  kind: "position";
  seatId: string;
  seatTitle: string;
  teamLabel: string;
  seatStatus: string;
  roleCode: string | null;
  member: EnterpriseOrgMemberNode | null;
};

export type EnterpriseOrgDepartmentNode = {
  kind: "department";
  label: string;
  fullPath: string;
  pathKey: string;
  level: number;
  childDepartments: EnterpriseOrgDepartmentNode[];
  positions: EnterpriseOrgPositionNode[];
  orderedChildren: EnterpriseOrgChildNode[];
};

/** @deprecated Use EnterpriseOrgDepartmentNode */
export type EnterpriseOrgTeamNode = EnterpriseOrgDepartmentNode;

function sortDepartments(nodes: EnterpriseOrgDepartmentNode[]): EnterpriseOrgDepartmentNode[] {
  return nodes
    .map((node) => ({
      ...node,
      childDepartments: sortDepartments(node.childDepartments),
      positions: node.positions.toSorted((left, right) =>
        left.seatTitle.localeCompare(right.seatTitle, "zh-CN"),
      ),
    }))
    .toSorted((left, right) => sortEnterpriseOrgDepartmentLabels(left.fullPath, right.fullPath));
}

function finalizeDepartmentTreeOrdering(
  departments: EnterpriseOrgDepartmentNode[],
  childOrders: Record<string, string[]>,
  parentPath: string,
): EnterpriseOrgDepartmentNode[] {
  for (const department of departments) {
    department.orderedChildren = buildOrderedChildren(department, childOrders);
    for (const child of department.childDepartments) {
      finalizeDepartmentChildOrdering(child, childOrders);
    }
  }
  const defaultRootKeys = departments.map((department) =>
    organizationChildDepartmentKey(department.fullPath),
  );
  const mergedRootKeys = mergeOrganizationChildOrderKeys(childOrders[parentPath], defaultRootKeys);
  const departmentsByPath = new Map(
    departments.map((department) => [department.fullPath, department]),
  );
  const ordered: EnterpriseOrgDepartmentNode[] = [];
  for (const key of mergedRootKeys) {
    if (!key.startsWith("department:")) {
      continue;
    }
    const fullPath = key.slice("department:".length);
    const department = departmentsByPath.get(fullPath);
    if (department) {
      ordered.push(department);
      departmentsByPath.delete(fullPath);
    }
  }
  for (const department of departmentsByPath.values()) {
    ordered.push(department);
  }
  return ordered;
}

function finalizeDepartmentChildOrdering(
  department: EnterpriseOrgDepartmentNode,
  childOrders: Record<string, string[]>,
) {
  department.orderedChildren = buildOrderedChildren(department, childOrders);
  for (const child of department.childDepartments) {
    finalizeDepartmentChildOrdering(child, childOrders);
  }
}

function insertPositionIntoDepartmentTree(
  root: EnterpriseOrgDepartmentNode[],
  nodeByPath: Map<string, EnterpriseOrgDepartmentNode>,
  position: EnterpriseOrgPositionNode,
) {
  const parts = splitOrganizationPath(position.teamLabel);
  for (let index = 0; index < parts.length; index += 1) {
    const pathParts = parts.slice(0, index + 1);
    const pathKey = organizationPathKey(pathParts);
    let department = nodeByPath.get(pathKey);
    if (!department) {
      department = {
        kind: "department",
        label: parts[index] ?? pathKey,
        fullPath: resolveOrganizationFullPath(pathParts),
        pathKey,
        level: index + 1,
        childDepartments: [],
        positions: [],
        orderedChildren: [],
      };
      nodeByPath.set(pathKey, department);
      if (index === 0) {
        if (!root.some((entry) => entry.pathKey === pathKey)) {
          root.push(department);
        }
      } else {
        const parentKey = organizationPathKey(pathParts.slice(0, -1));
        const parent = nodeByPath.get(parentKey);
        if (parent && !parent.childDepartments.some((entry) => entry.pathKey === pathKey)) {
          parent.childDepartments.push(department);
        }
      }
    }
  }
  const leafKey = organizationPathKey(parts);
  nodeByPath.get(leafKey)?.positions.push(position);
}

function ensureDepartmentPathInTree(
  root: EnterpriseOrgDepartmentNode[],
  nodeByPath: Map<string, EnterpriseOrgDepartmentNode>,
  fullPath: string,
) {
  const parts = splitOrganizationPath(fullPath);
  for (let index = 0; index < parts.length; index += 1) {
    const pathParts = parts.slice(0, index + 1);
    const pathKey = organizationPathKey(pathParts);
    let department = nodeByPath.get(pathKey);
    if (!department) {
      department = {
        kind: "department",
        label: parts[index] ?? pathKey,
        fullPath: resolveOrganizationFullPath(pathParts),
        pathKey,
        level: index + 1,
        childDepartments: [],
        positions: [],
        orderedChildren: [],
      };
      nodeByPath.set(pathKey, department);
      if (index === 0) {
        if (!root.some((entry) => entry.pathKey === pathKey)) {
          root.push(department);
        }
      } else {
        const parentKey = organizationPathKey(pathParts.slice(0, -1));
        const parent = nodeByPath.get(parentKey);
        if (parent && !parent.childDepartments.some((entry) => entry.pathKey === pathKey)) {
          parent.childDepartments.push(department);
        }
      }
    }
  }
}

export function buildEnterpriseOrgDepartmentTreeFromPositions(
  positions: EnterpriseOrgPositionNode[],
  query?: string,
  extraDepartmentPaths: string[] = [],
  childOrders: Record<string, string[]> = {},
): EnterpriseOrgDepartmentNode[] {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const root: EnterpriseOrgDepartmentNode[] = [];
  const nodeByPath = new Map<string, EnterpriseOrgDepartmentNode>();
  for (const fullPath of extraDepartmentPaths) {
    if (!normalizedQuery || fullPath.toLowerCase().includes(normalizedQuery)) {
      ensureDepartmentPathInTree(root, nodeByPath, fullPath);
    }
  }
  for (const position of positions) {
    if (normalizedQuery && !matchesEnterpriseOrgQuery(position, normalizedQuery)) {
      continue;
    }
    insertPositionIntoDepartmentTree(root, nodeByPath, position);
  }
  return finalizeDepartmentTreeOrdering(sortDepartments(root), childOrders, "");
}

export function buildEnterpriseOrgTree(params: {
  readModel: EnterprisePortReadModel;
  query?: string;
  includeVacantPositions?: boolean;
}): EnterpriseOrgDepartmentNode[] {
  const includeVacantPositions = params.includeVacantPositions ?? true;
  const memberBySeatId = new Map<string, EnterprisePortReadModel["memberSummaries"][number]>();
  for (const member of params.readModel.memberSummaries) {
    const seatTitle = member.seatTitle?.trim();
    if (!seatTitle) {
      continue;
    }
    const normalizedTeamLabel = member.seatTeamLabel?.trim() || null;
    const candidates = params.readModel.seatSummaries.filter((entry) => {
      if (entry.title.trim() !== seatTitle) {
        return false;
      }
      if (!normalizedTeamLabel) {
        return true;
      }
      return (entry.teamLabel?.trim() || "未分组") === normalizedTeamLabel;
    });
    if (candidates.length !== 1) {
      continue;
    }
    const seat = candidates[0];
    if (!seat || memberBySeatId.has(seat.seatId)) {
      continue;
    }
    memberBySeatId.set(seat.seatId, member);
  }

  const positions: EnterpriseOrgPositionNode[] = [];
  for (const seat of params.readModel.seatSummaries) {
    const seatTitle = seat.title.trim();
    if (!seatTitle) {
      continue;
    }
    const teamLabel = seat.teamLabel?.trim() || "未分组";
    const memberRecord = memberBySeatId.get(seat.seatId) ?? null;
    const position: EnterpriseOrgPositionNode = {
      kind: "position",
      seatId: seat.seatId,
      seatTitle,
      teamLabel,
      seatStatus: seat.status,
      roleCode: seat.roleCode?.trim() || null,
      member: memberRecord
        ? {
            kind: "member",
            user: memberRecord.user,
            displayLabel: memberRecord.displayLabel,
            membershipRole: memberRecord.membershipRole,
            status: memberRecord.status,
          }
        : null,
    };
    if (!includeVacantPositions && !position.member) {
      continue;
    }
    positions.push(position);
  }

  return buildEnterpriseOrgDepartmentTreeFromPositions(
    positions,
    params.query,
    params.readModel.organizationDepartmentPaths ?? [],
    params.readModel.organizationChildOrders ?? {},
  );
}

export function sortEnterpriseOrgDepartmentLabels(left: string, right: string): number {
  if (left === "未分组") {
    return 1;
  }
  if (right === "未分组") {
    return -1;
  }
  return left.localeCompare(right, "zh-CN");
}

/** @deprecated Use sortEnterpriseOrgDepartmentLabels */
export function sortEnterpriseOrgTeamLabels(left: string, right: string): number {
  return sortEnterpriseOrgDepartmentLabels(left, right);
}

export function matchesEnterpriseOrgQuery(
  position: EnterpriseOrgPositionNode,
  query: string,
): boolean {
  if (position.teamLabel.toLowerCase().includes(query)) {
    return true;
  }
  if (
    splitOrganizationPath(position.teamLabel).some((part) => part.toLowerCase().includes(query))
  ) {
    return true;
  }
  if (position.seatTitle.toLowerCase().includes(query)) {
    return true;
  }
  if (!position.member) {
    return false;
  }
  return (
    position.member.user.toLowerCase().includes(query) ||
    position.member.displayLabel.toLowerCase().includes(query) ||
    position.member.membershipRole.toLowerCase().includes(query)
  );
}

export function resolveEnterpriseOrgTreeSearchQuery(params: {
  input: string;
  readModel: EnterprisePortReadModel;
}): string {
  const query = params.input.trim();
  if (!query) {
    return "";
  }
  const normalized = query.toLowerCase();
  const exactMember = params.readModel.memberSummaries.some(
    (member) => member.user.toLowerCase() === normalized,
  );
  if (exactMember) {
    return "";
  }
  if (normalized.includes("@")) {
    return "";
  }
  return normalized;
}

export function departmentTreeContainsSeat(
  department: EnterpriseOrgDepartmentNode,
  seatId: string,
): boolean {
  if (department.positions.some((position) => position.seatId === seatId)) {
    return true;
  }
  return department.childDepartments.some((child) => departmentTreeContainsSeat(child, seatId));
}

export function shouldExpandEnterpriseOrgDepartment(params: {
  department: EnterpriseOrgDepartmentNode;
  activeTeam: string;
  selectedSeatId: string | null;
  query: string;
  autoExpandAll: boolean;
  focusTeamPath?: string | null;
  focusSeatId?: string | null;
}): boolean {
  if (params.autoExpandAll) {
    return true;
  }
  if (params.query) {
    return true;
  }
  if (
    params.focusTeamPath &&
    matchesOrganizationTeamPath(params.department.fullPath, params.focusTeamPath)
  ) {
    return true;
  }
  if (params.focusSeatId && departmentTreeContainsSeat(params.department, params.focusSeatId)) {
    return true;
  }
  if (
    params.activeTeam !== "all" &&
    matchesOrganizationTeamPath(params.department.fullPath, params.activeTeam)
  ) {
    return true;
  }
  if (
    params.selectedSeatId &&
    departmentTreeContainsSeat(params.department, params.selectedSeatId)
  ) {
    return true;
  }
  return params.department.childDepartments.some((child) =>
    shouldExpandEnterpriseOrgDepartment({ ...params, department: child }),
  );
}

/** @deprecated Use shouldExpandEnterpriseOrgDepartment */
export function shouldExpandEnterpriseOrgTeam(params: {
  teamLabel: string;
  positions: EnterpriseOrgPositionNode[];
  activeTeam: string;
  selectedSeatId: string | null;
  query: string;
  autoExpandAll: boolean;
}): boolean {
  return (
    params.autoExpandAll ||
    Boolean(params.query) ||
    (params.activeTeam !== "all" &&
      matchesOrganizationTeamPath(params.teamLabel, params.activeTeam)) ||
    (params.selectedSeatId
      ? params.positions.some((position) => position.seatId === params.selectedSeatId)
      : false)
  );
}

type EnterpriseOrgProvisionRow = {
  employeeName: string;
  employeeEmail: string;
  seatTitle: string;
  teamLabel?: string | null;
};

export type EnterpriseOrgSearchMatch = {
  kind: "team" | "position" | "member";
  label: string;
  secondary: string;
  breadcrumb: string;
  teamLabel: string;
  seatId: string | null;
  memberUser: string | null;
};

export function formatEnterpriseOrgBreadcrumb(parts: string[]): string {
  return parts.filter(Boolean).join(" › ");
}

export function buildEnterpriseOrgTreeFromProvisionRows(
  rows: EnterpriseOrgProvisionRow[],
  query?: string,
): EnterpriseOrgDepartmentNode[] {
  const positionKeys = new Set<string>();
  const positions: EnterpriseOrgPositionNode[] = [];
  for (const row of rows) {
    const seatTitle = row.seatTitle.trim();
    const teamLabel = row.teamLabel?.trim() || "未分组";
    if (!seatTitle) {
      continue;
    }
    const positionKey = `${teamLabel}::${seatTitle}`;
    if (positionKeys.has(positionKey)) {
      continue;
    }
    positionKeys.add(positionKey);
    positions.push({
      kind: "position",
      seatId: `preview:${positionKey}`,
      seatTitle,
      teamLabel,
      seatStatus: "preview",
      roleCode: null,
      member: row.employeeEmail
        ? {
            kind: "member",
            user: row.employeeEmail,
            displayLabel: row.employeeName.trim() || row.employeeEmail,
            membershipRole: "member",
            status: "preview",
          }
        : null,
    });
  }
  return buildEnterpriseOrgDepartmentTreeFromPositions(positions, query);
}

function walkEnterpriseOrgDepartments(
  departments: EnterpriseOrgDepartmentNode[],
  visit: (department: EnterpriseOrgDepartmentNode) => void,
) {
  for (const department of departments) {
    visit(department);
    walkEnterpriseOrgDepartments(department.childDepartments, visit);
  }
}

export function searchEnterpriseOrgDirectory(params: {
  readModel: EnterprisePortReadModel;
  query: string;
  limit?: number;
}): EnterpriseOrgSearchMatch[] {
  const query = params.query.trim().toLowerCase();
  if (!query) {
    return [];
  }
  const limit = params.limit ?? 12;
  const matches: EnterpriseOrgSearchMatch[] = [];
  const departments = buildEnterpriseOrgTree({
    readModel: params.readModel,
    includeVacantPositions: true,
  });

  walkEnterpriseOrgDepartments(departments, (department) => {
    const pathParts = splitOrganizationPath(department.fullPath);
    if (
      department.label.toLowerCase().includes(query) ||
      department.fullPath.toLowerCase().includes(query)
    ) {
      matches.push({
        kind: "team",
        label: department.label,
        secondary: `${department.positions.length} 个岗位`,
        breadcrumb: formatEnterpriseOrgBreadcrumb(pathParts),
        teamLabel: department.fullPath,
        seatId: null,
        memberUser: null,
      });
    }
    for (const position of department.positions) {
      const positionPath = formatEnterpriseOrgBreadcrumb([...pathParts, position.seatTitle]);
      if (position.seatTitle.toLowerCase().includes(query)) {
        matches.push({
          kind: "position",
          label: position.seatTitle,
          secondary: position.member?.displayLabel ?? "空岗",
          breadcrumb: positionPath,
          teamLabel: position.teamLabel,
          seatId: position.seatId,
          memberUser: position.member?.user ?? null,
        });
      }
      if (position.member) {
        const member = position.member;
        const memberHaystack = [member.user, member.displayLabel, member.membershipRole]
          .join(" ")
          .toLowerCase();
        if (memberHaystack.includes(query)) {
          matches.push({
            kind: "member",
            label: member.displayLabel,
            secondary: member.user,
            breadcrumb: formatEnterpriseOrgBreadcrumb([
              ...pathParts,
              position.seatTitle,
              member.displayLabel,
            ]),
            teamLabel: position.teamLabel,
            seatId: position.seatId,
            memberUser: member.user,
          });
        }
      }
    }
  });

  const seen = new Set<string>();
  return matches
    .filter((match) => {
      const key = `${match.kind}:${match.breadcrumb}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export { matchesOrganizationTeamPath };
