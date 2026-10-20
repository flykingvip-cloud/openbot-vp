import { splitOrganizationPath } from "./enterprise-org-path.ts";
import type {
  EnterpriseOrgDepartmentNode,
  EnterpriseOrgPositionNode,
} from "./enterprise-org-tree-model.ts";

export const ORGANIZATION_CHILD_DEPARTMENT_PREFIX = "department:";
export const ORGANIZATION_CHILD_SEAT_PREFIX = "seat:";

export type EnterpriseOrgChildNode =
  | { kind: "department"; department: EnterpriseOrgDepartmentNode }
  | { kind: "position"; position: EnterpriseOrgPositionNode };

export function organizationChildDepartmentKey(fullPath: string): string {
  return `${ORGANIZATION_CHILD_DEPARTMENT_PREFIX}${fullPath}`;
}

export function organizationChildSeatKey(seatId: string): string {
  return `${ORGANIZATION_CHILD_SEAT_PREFIX}${seatId}`;
}

export function departmentParentPath(fullPath: string): string {
  return splitOrganizationPath(fullPath).slice(0, -1).join("/");
}

export function mergeOrganizationChildOrderKeys(
  saved: string[] | undefined,
  defaultKeys: string[],
): string[] {
  if (!saved?.length) {
    return [...defaultKeys];
  }
  const remaining = new Set(defaultKeys);
  const merged: string[] = [];
  for (const key of saved) {
    if (remaining.has(key)) {
      merged.push(key);
      remaining.delete(key);
    }
  }
  for (const key of defaultKeys) {
    if (remaining.has(key)) {
      merged.push(key);
    }
  }
  return merged;
}

export function buildDefaultChildOrderKeys(department: EnterpriseOrgDepartmentNode): string[] {
  return [
    ...department.childDepartments.map((child) => organizationChildDepartmentKey(child.fullPath)),
    ...department.positions.map((position) => organizationChildSeatKey(position.seatId)),
  ];
}

export function buildOrderedChildren(
  department: EnterpriseOrgDepartmentNode,
  childOrders: Record<string, string[]>,
): EnterpriseOrgChildNode[] {
  const defaultKeys = buildDefaultChildOrderKeys(department);
  const mergedKeys = mergeOrganizationChildOrderKeys(childOrders[department.fullPath], defaultKeys);
  const departmentsByPath = new Map(
    department.childDepartments.map((child) => [child.fullPath, child]),
  );
  const positionsById = new Map(
    department.positions.map((position) => [position.seatId, position]),
  );
  const children: EnterpriseOrgChildNode[] = [];
  for (const key of mergedKeys) {
    if (key.startsWith(ORGANIZATION_CHILD_DEPARTMENT_PREFIX)) {
      const fullPath = key.slice(ORGANIZATION_CHILD_DEPARTMENT_PREFIX.length);
      const child = departmentsByPath.get(fullPath);
      if (child) {
        children.push({ kind: "department", department: child });
      }
      continue;
    }
    if (key.startsWith(ORGANIZATION_CHILD_SEAT_PREFIX)) {
      const seatId = key.slice(ORGANIZATION_CHILD_SEAT_PREFIX.length);
      const position = positionsById.get(seatId);
      if (position) {
        children.push({ kind: "position", position });
      }
    }
  }
  return children;
}

export function reorderOrganizationChildKeys(params: {
  currentKeys: string[];
  dragKey: string;
  targetKey: string;
  insertBefore: boolean;
}): string[] | null {
  const { currentKeys, dragKey, targetKey, insertBefore } = params;
  if (dragKey === targetKey || !currentKeys.includes(dragKey) || !currentKeys.includes(targetKey)) {
    return null;
  }
  const withoutDragged = currentKeys.filter((key) => key !== dragKey);
  const targetIndex = withoutDragged.indexOf(targetKey);
  if (targetIndex < 0) {
    return null;
  }
  const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
  return [...withoutDragged.slice(0, insertIndex), dragKey, ...withoutDragged.slice(insertIndex)];
}

export function resolveDraggedChildKey(params: {
  departmentPath?: string | null;
  seatId?: string | null;
}): string | null {
  if (params.departmentPath?.trim()) {
    return organizationChildDepartmentKey(params.departmentPath.trim());
  }
  if (params.seatId?.trim()) {
    return organizationChildSeatKey(params.seatId.trim());
  }
  return null;
}

export function resolveDraggedChildParentPath(params: {
  departmentPath?: string | null;
  seatTeamLabel?: string | null;
}): string | null {
  if (params.departmentPath?.trim()) {
    return departmentParentPath(params.departmentPath.trim());
  }
  if (params.seatTeamLabel != null) {
    const teamLabel = params.seatTeamLabel.trim() || "未分组";
    return teamLabel === "未分组" ? "" : teamLabel;
  }
  return null;
}

export function buildDirectChildOrderKeysFromReadModel(
  parentPath: string,
  options: {
    organizationDepartmentPaths: string[];
    seatSummaries: Array<{ seatId: string; teamLabel: string | null }>;
  },
): string[] {
  const normalizedParent = parentPath.trim();
  const keys: string[] = [];
  for (const path of options.organizationDepartmentPaths) {
    if (departmentParentPath(path) === normalizedParent) {
      keys.push(organizationChildDepartmentKey(path));
    }
  }
  for (const seat of options.seatSummaries) {
    const teamLabel = seat.teamLabel?.trim() || "未分组";
    if (teamLabel === normalizedParent) {
      keys.push(organizationChildSeatKey(seat.seatId));
    }
  }
  return keys;
}

export function finalizeReorderKeysForServer(
  reordered: string[],
  allKeys: string[],
): string[] | null {
  if (!allKeys.length) {
    return null;
  }
  const allSet = new Set(allKeys);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of reordered) {
    if (!allSet.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
  }
  for (const key of allKeys) {
    if (!seen.has(key)) {
      result.push(key);
    }
  }
  return result.length === allKeys.length ? result : null;
}

export function resolveTargetChildKey(params: {
  kind: "department" | "position";
  departmentPath?: string;
  seatId?: string;
}): string | null {
  if (params.kind === "department" && params.departmentPath) {
    return organizationChildDepartmentKey(params.departmentPath);
  }
  if (params.kind === "position" && params.seatId) {
    return organizationChildSeatKey(params.seatId);
  }
  return null;
}
