/**
 * 模型授权左侧目录：优先企业组织树，否则回退到席位/员工选项或已有授权主体。
 * 纯函数，供授权面板与浏览器测试共用。
 */

import type {
  ModelGrantSubjectType,
  SeatModelGrant,
} from "../capability/model-authorization/types.ts";
import {
  buildEnterpriseOrgDepartmentTreeFromPositions,
  type EnterpriseOrgDepartmentNode,
  type EnterpriseOrgMemberNode,
  type EnterpriseOrgPositionNode,
} from "../ports/enterprise/views/enterprise-org-tree-model.ts";

export type ModelAuthorizationOrgSeat = {
  seatId: string;
  title: string;
  teamLabel: string | null;
  status: string;
  roleCode: string | null;
  occupantLabel: string | null;
  occupantUser: string | null;
};

export type ModelAuthorizationOrgMember = {
  user: string;
  displayLabel: string;
  membershipRole: string;
  status: string;
  seatTitle: string | null;
  seatTeamLabel: string | null;
};

export type ModelAuthorizationOrgRoster = {
  departmentPaths: string[];
  childOrders?: Record<string, string[]>;
  seats: ModelAuthorizationOrgSeat[];
  members: ModelAuthorizationOrgMember[];
};

export type ModelAuthorizationSubjectOption = {
  id: string;
  label: string;
};

export type ModelAuthorizationDirectoryEntry = {
  key: string;
  kind: "group" | "subject";
  label: string;
  meta?: string;
  depth: number;
  subjectType?: ModelGrantSubjectType;
  subjectId?: string;
  roleLabel?: string | null;
  grantedCount?: number;
};

function subjectKey(subjectType: ModelGrantSubjectType, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

function visibleGrantedIds(
  grant: SeatModelGrant | undefined,
  hidden: ReadonlySet<string>,
): string[] {
  if (!grant) {
    return [];
  }
  return grant.grantedModelIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && !hidden.has(id));
}

function grantedCount(
  grants: readonly SeatModelGrant[],
  subjectType: ModelGrantSubjectType,
  subjectId: string,
  hidden: ReadonlySet<string>,
): number {
  const grant = grants.find(
    (entry) => entry.subjectType === subjectType && entry.subjectId === subjectId,
  );
  return visibleGrantedIds(grant, hidden).length;
}

function matchesQuery(query: string, ...parts: Array<string | null | undefined>): boolean {
  if (!query) {
    return true;
  }
  const haystack = parts
    .map((part) => part?.trim().toLowerCase() ?? "")
    .filter((part) => part.length > 0)
    .join(" ");
  return haystack.includes(query);
}

function memberNode(member: ModelAuthorizationOrgMember): EnterpriseOrgMemberNode {
  return {
    kind: "member",
    user: member.user,
    displayLabel: member.displayLabel,
    membershipRole: member.membershipRole,
    status: member.status,
  };
}

function occupantNode(seat: ModelAuthorizationOrgSeat): EnterpriseOrgMemberNode | null {
  const occupantLabel = seat.occupantLabel?.trim() || "";
  const occupantUser = seat.occupantUser?.trim() || "";
  if (!occupantLabel && !occupantUser) {
    return null;
  }
  return {
    kind: "member",
    user: occupantUser || occupantLabel,
    displayLabel: occupantLabel || occupantUser,
    membershipRole: "",
    status: "active",
  };
}

/**
 * 与组织树 `buildEnterpriseOrgTree` 相同：按成员找唯一席位。
 * 未填团队的成员会匹配所有同名席位，只有恰好一个候选席位时才挂上。
 * 挂不上的席位回退到 occupant，避免一个人的名字出现在每个同名岗位上。
 */
function assignMembersToSeats(
  seats: readonly ModelAuthorizationOrgSeat[],
  members: readonly ModelAuthorizationOrgMember[],
): Map<string, EnterpriseOrgMemberNode> {
  const usable = seats.filter((seat) => seat.title.trim() && seat.seatId.trim());
  const memberBySeatId = new Map<string, EnterpriseOrgMemberNode>();
  for (const member of members) {
    const seatTitle = member.seatTitle?.trim();
    if (!seatTitle) {
      continue;
    }
    const normalizedTeamLabel = member.seatTeamLabel?.trim() || null;
    const candidates = usable.filter((seat) => {
      if (seat.title.trim() !== seatTitle) {
        return false;
      }
      if (!normalizedTeamLabel) {
        return true;
      }
      return (seat.teamLabel?.trim() || "未分组") === normalizedTeamLabel;
    });
    if (candidates.length !== 1) {
      continue;
    }
    const seat = candidates[0];
    if (!seat || memberBySeatId.has(seat.seatId)) {
      continue;
    }
    memberBySeatId.set(seat.seatId, memberNode(member));
  }
  return memberBySeatId;
}

export function buildModelAuthorizationOrgDepartments(input: {
  orgRoster?: ModelAuthorizationOrgRoster | null;
  query?: string;
}): EnterpriseOrgDepartmentNode[] {
  const roster = input.orgRoster;
  const positions = roster ? positionsFromRoster(roster) : [];
  if (!roster || positions.length === 0) {
    return [];
  }
  const query = input.query?.trim().toLowerCase() ?? "";
  return buildEnterpriseOrgDepartmentTreeFromPositions(
    positions,
    query || undefined,
    roster.departmentPaths,
    roster.childOrders ?? {},
  );
}

function positionsFromRoster(roster: ModelAuthorizationOrgRoster): EnterpriseOrgPositionNode[] {
  const assigned = assignMembersToSeats(roster.seats, roster.members);
  const positions: EnterpriseOrgPositionNode[] = [];
  for (const seat of roster.seats) {
    const seatTitle = seat.title.trim();
    if (!seatTitle || !seat.seatId.trim()) {
      continue;
    }
    positions.push({
      kind: "position",
      seatId: seat.seatId,
      seatTitle,
      teamLabel: seat.teamLabel?.trim() || "未分组",
      seatStatus: seat.status,
      roleCode: seat.roleCode?.trim() || null,
      member: assigned.get(seat.seatId) ?? occupantNode(seat),
    });
  }
  return positions;
}

function appendDepartment(
  department: EnterpriseOrgDepartmentNode,
  depth: number,
  grants: readonly SeatModelGrant[],
  hidden: ReadonlySet<string>,
  out: ModelAuthorizationDirectoryEntry[],
) {
  out.push({
    key: `group:${department.pathKey}`,
    kind: "group",
    label: department.label,
    depth,
  });
  const children = department.orderedChildren.length
    ? department.orderedChildren
    : [
        ...department.childDepartments.map((child) => ({
          kind: "department" as const,
          department: child,
        })),
        ...department.positions.map((position) => ({ kind: "position" as const, position })),
      ];
  for (const child of children) {
    if (child.kind === "department") {
      appendDepartment(child.department, depth + 1, grants, hidden, out);
      continue;
    }
    const position = child.position;
    const occupant = position.member?.displayLabel.trim() || "";
    out.push({
      key: subjectKey("seat", position.seatId),
      kind: "subject",
      label: occupant || position.seatTitle,
      meta: occupant ? position.seatTitle : "空岗",
      depth: depth + 1,
      subjectType: "seat",
      subjectId: position.seatId,
      roleLabel: position.roleCode,
      grantedCount: grantedCount(grants, "seat", position.seatId, hidden),
    });
  }
}

function orphanEntries(params: {
  grants: readonly SeatModelGrant[];
  covered: ReadonlySet<string>;
  query: string;
  label: string;
  hidden: ReadonlySet<string>;
}): ModelAuthorizationDirectoryEntry[] {
  const orphans = params.grants.filter((grant) => {
    const key = subjectKey(grant.subjectType, grant.subjectId);
    if (params.covered.has(key)) {
      return false;
    }
    const kindLabel = grant.subjectType === "employee" ? "员工" : "席位";
    return matchesQuery(
      params.query,
      kindLabel,
      grant.subjectId,
      ...visibleGrantedIds(grant, params.hidden),
    );
  });
  if (!orphans.length) {
    return [];
  }
  return [
    { key: "group:orphans", kind: "group", label: params.label, depth: 0 },
    ...orphans.map((grant) => ({
      key: subjectKey(grant.subjectType, grant.subjectId),
      kind: "subject" as const,
      label: `${grant.subjectType === "employee" ? "员工" : "席位"} · ${grant.subjectId}`,
      meta: grant.status === "active" ? "已有授权" : "已撤销",
      depth: 1,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      grantedCount: visibleGrantedIds(grant, params.hidden).length,
    })),
  ];
}

function optionDirectory(params: {
  grants: readonly SeatModelGrant[];
  seatOptions: readonly ModelAuthorizationSubjectOption[];
  memberOptions: readonly ModelAuthorizationSubjectOption[];
  query: string;
  hidden: ReadonlySet<string>;
}): ModelAuthorizationDirectoryEntry[] {
  const covered = new Set<string>();
  const entries: ModelAuthorizationDirectoryEntry[] = [];
  const pushOptions = (
    groupKey: string,
    groupLabel: string,
    subjectType: ModelGrantSubjectType,
    options: readonly ModelAuthorizationSubjectOption[],
  ) => {
    const visible = options.filter((option) =>
      matchesQuery(params.query, option.label, option.id, groupLabel),
    );
    if (!visible.length) {
      return;
    }
    entries.push({ key: groupKey, kind: "group", label: groupLabel, depth: 0 });
    for (const option of visible) {
      const key = subjectKey(subjectType, option.id);
      covered.add(key);
      entries.push({
        key,
        kind: "subject",
        label: option.label || option.id,
        meta: option.label && option.label !== option.id ? option.id : undefined,
        depth: 1,
        subjectType,
        subjectId: option.id,
        grantedCount: grantedCount(params.grants, subjectType, option.id, params.hidden),
      });
    }
  };
  pushOptions("group:seats", "席位", "seat", params.seatOptions);
  pushOptions("group:members", "员工", "employee", params.memberOptions);
  entries.push(
    ...orphanEntries({
      grants: params.grants,
      covered,
      query: params.query,
      label: "其他已授权",
      hidden: params.hidden,
    }),
  );
  return entries;
}

export function buildModelAuthorizationDirectory(input: {
  grants: readonly SeatModelGrant[];
  orgRoster?: ModelAuthorizationOrgRoster | null;
  seatOptions?: readonly ModelAuthorizationSubjectOption[];
  memberOptions?: readonly ModelAuthorizationSubjectOption[];
  query?: string;
  /** 已离开平台池或未连通的平台模型。不计入席位上的「N 个模型」。 */
  hiddenModelIds?: readonly string[];
}): ModelAuthorizationDirectoryEntry[] {
  const query = input.query?.trim().toLowerCase() ?? "";
  const hidden = new Set(
    (input.hiddenModelIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0),
  );
  const seatOptions = input.seatOptions ?? [];
  const memberOptions = input.memberOptions ?? [];
  const roster = input.orgRoster;
  const positions = roster ? positionsFromRoster(roster) : [];
  if (roster && positions.length > 0) {
    const tree = buildModelAuthorizationOrgDepartments(input);
    const entries: ModelAuthorizationDirectoryEntry[] = [];
    for (const department of tree) {
      appendDepartment(department, 0, input.grants, hidden, entries);
    }
    const covered = new Set(
      entries.filter((entry) => entry.kind === "subject").map((entry) => entry.key),
    );
    entries.push(
      ...orphanEntries({
        grants: input.grants,
        covered,
        query,
        label: "未挂到组织的授权",
        hidden,
      }),
    );
    return entries;
  }
  if (seatOptions.length > 0 || memberOptions.length > 0) {
    return optionDirectory({
      grants: input.grants,
      seatOptions,
      memberOptions,
      query,
      hidden,
    });
  }
  return orphanEntries({
    grants: input.grants,
    covered: new Set(),
    query,
    label: "已授权主体",
    hidden,
  });
}
