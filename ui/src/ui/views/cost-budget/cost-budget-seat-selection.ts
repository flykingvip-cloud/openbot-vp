import type { EnterpriseOrgDepartmentNode } from "../../ports/enterprise/views/enterprise-org-tree-model.ts";

export type SeatMemberSelection = {
  userId: string;
  displayLabel: string;
};

export function normalizeSeatAssignUserId(userId: string): string {
  return userId.trim().toLowerCase();
}

export function buildAssignedSeatUserIdSet(
  seats: ReadonlyArray<{ userId: string }>,
): ReadonlySet<string> {
  return new Set(seats.map((seat) => normalizeSeatAssignUserId(seat.userId)).filter(Boolean));
}

export function isSeatMemberAssignable(
  userId: string,
  assignedSeatUserIds: ReadonlySet<string>,
): boolean {
  return !assignedSeatUserIds.has(normalizeSeatAssignUserId(userId));
}

export function findEnterpriseOrgDepartment(
  departments: EnterpriseOrgDepartmentNode[],
  fullPath: string,
): EnterpriseOrgDepartmentNode | null {
  for (const department of departments) {
    if (department.fullPath === fullPath) {
      return department;
    }
    const nested = findEnterpriseOrgDepartment(department.childDepartments, fullPath);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function collectAssignableMembersFromDepartment(
  department: EnterpriseOrgDepartmentNode,
  assignedSeatUserIds: ReadonlySet<string>,
): SeatMemberSelection[] {
  const members: SeatMemberSelection[] = [];
  const seen = new Set<string>();

  const visit = (node: EnterpriseOrgDepartmentNode) => {
    for (const position of node.positions) {
      const member = position.member;
      if (!member || member.status !== "active") {
        continue;
      }
      const userId = member.user.trim();
      if (!userId || !isSeatMemberAssignable(userId, assignedSeatUserIds)) {
        continue;
      }
      const key = normalizeSeatAssignUserId(userId);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      members.push({
        userId,
        displayLabel: member.displayLabel.trim() || userId,
      });
    }
    for (const child of node.childDepartments) {
      visit(child);
    }
  };

  visit(department);
  return members;
}

export function addSeatMemberSelections(
  selected: Map<string, string>,
  members: ReadonlyArray<SeatMemberSelection>,
): Map<string, string> {
  const next = new Map(selected);
  for (const member of members) {
    next.set(member.userId, member.displayLabel);
  }
  return next;
}

export function pruneAssignedSeatSelections(
  selected: Map<string, string>,
  assignedSeatUserIds: ReadonlySet<string>,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const [userId, displayLabel] of selected.entries()) {
    if (isSeatMemberAssignable(userId, assignedSeatUserIds)) {
      next.set(userId, displayLabel);
    }
  }
  return next;
}

export function toggleSeatMemberSelection(
  selected: Map<string, string>,
  userId: string,
  displayLabel: string,
  assignedSeatUserIds?: ReadonlySet<string>,
): Map<string, string> {
  if (assignedSeatUserIds && !isSeatMemberAssignable(userId, assignedSeatUserIds)) {
    return selected;
  }
  const next = new Map(selected);
  if (next.has(userId)) {
    next.delete(userId);
  } else {
    next.set(userId, displayLabel);
  }
  return next;
}

export function removeSeatMemberSelection(
  selected: Map<string, string>,
  userId: string,
): Map<string, string> {
  const next = new Map(selected);
  next.delete(userId);
  return next;
}

export function listSeatMemberSelections(selected: Map<string, string>): SeatMemberSelection[] {
  return [...selected.entries()].map(([userId, displayLabel]) => ({ userId, displayLabel }));
}

export function parseSeatAssignUserIds(
  raw: string,
  assignedSeatUserIds?: ReadonlySet<string>,
): string[] {
  const parsed = [
    ...new Set(
      raw
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  if (!assignedSeatUserIds) {
    return parsed;
  }
  return parsed.filter((userId) => isSeatMemberAssignable(userId, assignedSeatUserIds));
}
