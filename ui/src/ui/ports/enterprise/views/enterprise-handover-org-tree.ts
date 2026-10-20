import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  buildEnterpriseOrgTree,
  resolveEnterpriseOrgTreeSearchQuery,
  type EnterpriseOrgDepartmentNode,
  type EnterpriseOrgPositionNode,
} from "./enterprise-org-tree-model.ts";

export type HandoverOrgPositionNode = EnterpriseOrgPositionNode & {
  isHandoverSeat: boolean;
  selectable: boolean;
  member:
    | (NonNullable<EnterpriseOrgPositionNode["member"]> & {
        membershipRole: string;
      })
    | null;
};

export type HandoverOrgPositionLookup = Map<string, HandoverOrgPositionNode>;

export function resolveHandoverOrgTreeQuery(params: {
  successorEmail: string;
  readModel: EnterprisePortReadModel;
}): string {
  return resolveEnterpriseOrgTreeSearchQuery({
    input: params.successorEmail ?? "",
    readModel: params.readModel,
  });
}

export function buildHandoverOrganizationTree(params: {
  readModel: EnterprisePortReadModel;
  handoverSeatId: string | null;
  handoverSeatTitle: string;
  outgoingEmployeeUser: string | null;
  authenticatedUser: string | null;
  query?: string;
}): {
  departments: EnterpriseOrgDepartmentNode[];
  positionLookup: HandoverOrgPositionLookup;
} {
  const departments = buildEnterpriseOrgTree({
    readModel: params.readModel,
    query: params.query,
    includeVacantPositions: true,
  });
  const positionLookup: HandoverOrgPositionLookup = new Map();

  const annotate = (position: EnterpriseOrgPositionNode): HandoverOrgPositionNode => {
    const memberRecord = position.member
      ? (params.readModel.memberSummaries.find((entry) => entry.user === position.member!.user) ??
        null)
      : null;
    const selectable = isHandoverSuccessorCandidate({
      member: memberRecord,
      outgoingEmployeeUser: params.outgoingEmployeeUser,
      authenticatedUser: params.authenticatedUser,
    });
    const annotated: HandoverOrgPositionNode = {
      ...position,
      isHandoverSeat:
        (params.handoverSeatId && position.seatId === params.handoverSeatId) ||
        position.seatTitle === params.handoverSeatTitle.trim(),
      selectable,
      member: position.member
        ? {
            ...position.member,
            membershipRole: memberRecord?.membershipRole ?? "member",
          }
        : null,
    };
    positionLookup.set(position.seatId, annotated);
    return annotated;
  };

  const annotateDepartments = (
    nodes: EnterpriseOrgDepartmentNode[],
  ): EnterpriseOrgDepartmentNode[] =>
    nodes.map((department) => ({
      ...department,
      positions: department.positions.map((position) => annotate(position)),
      childDepartments: annotateDepartments(department.childDepartments),
    }));

  return {
    departments: annotateDepartments(departments),
    positionLookup,
  };
}

export function isHandoverSuccessorCandidate(params: {
  member: EnterprisePortReadModel["memberSummaries"][number] | null;
  outgoingEmployeeUser: string | null;
  authenticatedUser: string | null;
}): boolean {
  const member = params.member;
  if (!member || member.status !== "active") {
    return false;
  }
  if (params.outgoingEmployeeUser && member.user === params.outgoingEmployeeUser) {
    return false;
  }
  if (params.authenticatedUser && member.user === params.authenticatedUser) {
    return false;
  }
  return true;
}
