import type { DataPlaneCase } from "./diagnose-data-plane-cases.js";
import {
  expandDiagnoseGroupMembers,
  type ExpandDiagnoseGroupMembersInput,
  type GroupMemberExpandResult,
} from "./diagnose-group-member-expand.js";
/**
 * Track I / M2 — materialize InterventionCase from diagnose-next-actions
 * and Track D dataPlaneCases; expand group parents via diagnose-group-member-expand.
 */
import type { DiagnoseConversationAction } from "./diagnose-next-actions.js";
import type { InterventionCaseStore } from "./intervention-case-store.js";
import {
  newInterventionCaseId,
  transitionInterventionCase,
  type InterventionActionKind,
  type InterventionCase,
  type InterventionCaseId,
} from "./intervention-case.js";

const ACTION_KINDS: ReadonlySet<string> = new Set([
  "bootstrap",
  "identity",
  "memory",
  "practice",
  "review",
]);

export function actionKindFromActionId(actionId: string): InterventionActionKind {
  const kind = actionId.split(":")[1] ?? "";
  if (ACTION_KINDS.has(kind)) {
    return kind as InterventionActionKind;
  }
  return "review";
}

export function actionKindFromDataPlaneCase(
  caseKind: DataPlaneCase["caseKind"],
): InterventionActionKind {
  switch (caseKind) {
    case "locator_failed":
      return "bootstrap";
    case "growth_identity_gap":
    case "growth_user_gap":
      return "identity";
    case "growth_memory_gap":
      return "memory";
    case "evidence_gap":
    default:
      return "review";
  }
}

export type MaterializeInterventionContext = {
  tenantId: string | null;
  /** Optional growth group id when actions alone omit it (group diagnosis). */
  growthGroupId?: string | null;
  now?: string;
  store?: InterventionCaseStore;
};

function titleForDataPlane(dp: DataPlaneCase): string {
  switch (dp.caseKind) {
    case "locator_failed":
      return "定位失败需处置";
    case "growth_identity_gap":
    case "growth_user_gap":
      return "补身份字段";
    case "growth_memory_gap":
      return "补当日记忆";
    case "evidence_gap":
      return "补观测证据";
    default:
      return dp.findingCode;
  }
}

/**
 * Map Track D dataPlaneCases (incl. locator_failed) → InterventionCase at status=suggested.
 * Field names preserved (schemaVersion/caseKind/status/tenantId/findingCode/source/target).
 */
export function materializeInterventionCasesFromDataPlane(
  cases: readonly DataPlaneCase[],
  context: MaterializeInterventionContext = { tenantId: null },
): InterventionCase[] {
  const now = context.now ?? new Date().toISOString();
  const out: InterventionCase[] = [];
  for (const dp of cases) {
    // Track D emits status:"suggested" — keep without rename.
    if (dp.status !== "suggested") {
      continue;
    }
    const agentId = dp.target.agentId ?? dp.source.growthAgentId;
    const groupId = dp.source.growthGroupId;
    const isGroup = dp.target.kind === "group_parent" || Boolean(groupId);
    const row: InterventionCase = {
      schemaVersion: 1,
      caseId: newInterventionCaseId(`dp-${dp.findingCode}-${agentId ?? groupId ?? "x"}`),
      tenantId: context.tenantId ?? dp.tenantId,
      status: "suggested",
      actionKind: actionKindFromDataPlaneCase(dp.caseKind),
      title: titleForDataPlane(dp),
      actor:
        dp.caseKind.startsWith("growth_identity") || dp.caseKind === "growth_user_gap"
          ? "owner"
          : "diagnosed_agent",
      source: {
        actionId: `act:dp:${dp.findingCode}:${agentId ?? groupId ?? "target"}`,
        growthAgentId: dp.source.growthAgentId,
        growthGroupId: dp.source.growthGroupId,
        ...(dp.source.reportRef ? { reportRef: dp.source.reportRef } : {}),
        dataPlaneCaseKind: dp.caseKind,
        findingCode: dp.findingCode,
      },
      target: isGroup
        ? { kind: "group_parent", agentId: agentId, sessionKey: null }
        : {
            kind: "agent_1to1",
            agentId,
            sessionKey: dp.target.sessionKey ?? (agentId ? `agent:${agentId}:main` : null),
          },
      createdAt: dp.createdAt || now,
      updatedAt: now,
    };
    out.push(row);
    context.store?.put(row);
  }
  return out;
}

export function materializeInterventionCases(
  actions: readonly DiagnoseConversationAction[],
  context: MaterializeInterventionContext = { tenantId: null },
): InterventionCase[] {
  const now = context.now ?? new Date().toISOString();
  const out: InterventionCase[] = [];
  for (const action of actions) {
    const groupId = context.growthGroupId?.trim() || null;
    // Group diagnosis: parent expands first — never queue a space sessionKey.
    const isGroup = Boolean(groupId);
    const agentId = action.targetAgentId;
    const kind = actionKindFromActionId(action.actionId);
    const row: InterventionCase = {
      schemaVersion: 1,
      caseId: newInterventionCaseId(action.actionId),
      tenantId: context.tenantId,
      status: isGroup ? "expanding" : "queued",
      actionKind: kind,
      title: action.title,
      actor: action.actor,
      source: {
        actionId: action.actionId,
        growthAgentId: agentId,
        growthGroupId: groupId,
      },
      target: isGroup
        ? { kind: "group_parent", agentId, sessionKey: null }
        : {
            kind: "agent_1to1",
            agentId,
            sessionKey:
              action.targetSessionKey && !action.targetSessionKey.includes(":space:")
                ? action.targetSessionKey
                : agentId
                  ? `agent:${agentId}:main`
                  : null,
          },
      createdAt: now,
      updatedAt: now,
    };
    out.push(row);
    context.store?.put(row);
  }
  return out;
}

export type ExpandGroupInterventionInput = {
  parent: InterventionCase;
  store: InterventionCaseStore;
  expand?: ExpandDiagnoseGroupMembersInput;
  /** Precomputed expand result (tests / reuse Track D output). */
  expandResult?: GroupMemberExpandResult;
  now?: string;
  /** Child filter: only members that still need this actionKind (optional). */
  memberNeedsAction?: (row: { agentId: string | null; sessionKey1to1: string | null }) => boolean;
};

export type ExpandGroupInterventionResult =
  | { ok: true; parent: InterventionCase; children: InterventionCase[] }
  | { ok: false; parent: InterventionCase; reason: string };

/**
 * Expand group_parent via Track D expandDiagnoseGroupMembers — one member table only.
 * Parent becomes queued (aggregate); real dispatch hits children only.
 */
export async function expandGroupInterventionCase(
  input: ExpandGroupInterventionInput,
): Promise<ExpandGroupInterventionResult> {
  const now = input.now ?? new Date().toISOString();
  const parent = input.parent;
  if (parent.target.kind !== "group_parent") {
    return { ok: false, parent, reason: "not_group_parent" };
  }
  const groupId = parent.source.growthGroupId?.trim() ?? "";
  if (!groupId) {
    const blocked = transitionInterventionCase(parent, "blocked", {
      blockReason: "group_not_1to1",
      updatedAt: now,
    });
    const row = blocked.ok
      ? blocked.case
      : { ...parent, status: "blocked" as const, blockReason: "group_not_1to1", updatedAt: now };
    input.store.put(row);
    return { ok: false, parent: row, reason: "group_not_1to1" };
  }

  let expanded: GroupMemberExpandResult;
  if (input.expandResult) {
    expanded = input.expandResult;
  } else if (input.expand) {
    expanded = await expandDiagnoseGroupMembers({
      ...input.expand,
      groupId,
      tenantId: input.expand.tenantId || parent.tenantId || "",
    });
  } else {
    const blocked = transitionInterventionCase(parent, "blocked", {
      blockReason: "expand_failed",
      updatedAt: now,
    });
    const row = blocked.ok
      ? blocked.case
      : { ...parent, status: "blocked" as const, blockReason: "expand_failed", updatedAt: now };
    input.store.put(row);
    return { ok: false, parent: row, reason: "expand_failed" };
  }

  if (expanded.emptyReason || expanded.members.length === 0) {
    const reason =
      expanded.emptyReason === "members_unreadable" ? "expand_failed" : "expand_failed";
    const blocked = transitionInterventionCase(parent, "blocked", {
      blockReason: reason,
      updatedAt: now,
    });
    const row = blocked.ok
      ? blocked.case
      : { ...parent, status: "blocked" as const, blockReason: reason, updatedAt: now };
    input.store.put(row);
    return { ok: false, parent: row, reason };
  }

  const children: InterventionCase[] = [];
  const childIds: InterventionCaseId[] = [];
  for (const member of expanded.members) {
    if (!member.agentId || !member.sessionKey1to1) {
      continue;
    }
    if (member.sessionKey1to1.includes(":space:")) {
      continue;
    }
    if (input.memberNeedsAction && !input.memberNeedsAction(member)) {
      continue;
    }
    const childId = newInterventionCaseId(`${parent.caseId}-${member.agentId}`);
    const child: InterventionCase = {
      schemaVersion: 1,
      caseId: childId,
      tenantId: parent.tenantId,
      status: "queued",
      actionKind: parent.actionKind,
      title: parent.title,
      actor: parent.actor,
      source: {
        ...parent.source,
        actionId: `${parent.source.actionId}:member:${member.agentId}`,
        growthAgentId: member.agentId,
        growthGroupId: groupId,
      },
      target: {
        kind: "member_1to1",
        agentId: member.agentId,
        sessionKey: member.sessionKey1to1,
        parentCaseId: parent.caseId,
      },
      createdAt: now,
      updatedAt: now,
    };
    children.push(child);
    childIds.push(childId);
    input.store.put(child);
  }

  if (children.length === 0) {
    const blocked = transitionInterventionCase(parent, "blocked", {
      blockReason: "expand_failed",
      updatedAt: now,
    });
    const row = blocked.ok
      ? blocked.case
      : { ...parent, status: "blocked" as const, blockReason: "expand_failed", updatedAt: now };
    input.store.put(row);
    return { ok: false, parent: row, reason: "expand_failed" };
  }

  const queued = transitionInterventionCase(parent, "queued", {
    children: childIds,
    updatedAt: now,
  });
  const parentOut = queued.ok
    ? queued.case
    : { ...parent, status: "queued" as const, children: childIds, updatedAt: now };
  input.store.put(parentOut);
  return { ok: true, parent: parentOut, children };
}
