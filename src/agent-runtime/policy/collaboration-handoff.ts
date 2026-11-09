import type { TaskHandoff, TaskResponsibility } from "./collaboration-policy-model.js";

/**
 * Pure handoff decisions. Propose/accept/approve/apply writes stay in the handoff transaction.
 * Switches and recovery order are not changed here.
 */

export type HandoffResponsibilityRole =
  | "owner"
  | "executor"
  | "reviewer"
  | "approver"
  | "contributor";
export type HandoffKindName = "continue" | "review" | "owner_transfer" | "evidence";
export type HandoffApprovalName = "none" | "human" | "governance";

export type HandoffPartyView = {
  agentId: string;
  responsibilityRole: HandoffResponsibilityRole;
};

export type HandoffContractView = {
  handoffId: string;
  kind: HandoffKindName;
  from: HandoffPartyView;
  to: HandoffPartyView;
  baseHistoryLen?: number;
};

export type HandoffTaskView = {
  ownerMemberId?: string | null;
  assignedMemberIds?: readonly string[] | null;
  responsibility?: TaskResponsibility | null;
  handoffs?: readonly { handoffId?: string | null }[] | null;
};

export type HandoffLiveApplyDecision =
  | { kind: "apply"; responsibility: TaskResponsibility }
  | { kind: "idempotent"; responsibility: TaskResponsibility }
  | { kind: "already_at_target"; responsibility: TaskResponsibility; detail: string }
  | { kind: "conflict"; detail: string; responsibility: TaskResponsibility };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function uniqueIds(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const id = compact(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function resolveHandoffApproval(
  kind: HandoffKindName,
  toRole: HandoffResponsibilityRole,
  requested: HandoffApprovalName | undefined,
): HandoffApprovalName {
  if (toRole === "owner" || toRole === "approver" || kind === "owner_transfer") {
    return "human";
  }
  if (requested === "human" || requested === "governance" || requested === "none") {
    return requested;
  }
  return "none";
}

export function handoffPartyLooksLikeBot(agentId: string): boolean {
  const id = agentId.trim().toLowerCase();
  return id.startsWith("bot:") || id.startsWith("agent:");
}

export function responsibilityFromHandoffTask(task: HandoffTaskView): TaskResponsibility {
  if (task.responsibility) {
    return {
      ...task.responsibility,
      executors: [...task.responsibility.executors],
    };
  }
  const owner = compact(task.ownerMemberId) || "group";
  const assigned = uniqueIds(task.assignedMemberIds ?? undefined);
  return {
    owner,
    executors: assigned.length > 0 ? assigned : owner === "group" ? [] : [owner],
    decisionAuthority: owner,
  };
}

export function applyHandoffContractToResponsibility(
  current: TaskResponsibility,
  contract: HandoffContractView,
): TaskResponsibility {
  const to = contract.to.agentId;
  if (contract.kind === "owner_transfer" || contract.to.responsibilityRole === "owner") {
    return { ...current, owner: to };
  }
  if (contract.to.responsibilityRole === "reviewer") {
    return { ...current, reviewer: to };
  }
  if (contract.to.responsibilityRole === "approver") {
    return { ...current, approver: to };
  }
  const executors = uniqueIds([
    to,
    ...current.executors.filter((id) => id !== contract.from.agentId),
  ]);
  return { ...current, executors };
}

export function classifyHandoffApplyAgainstLive(params: {
  contract: HandoffContractView;
  live: HandoffTaskView;
  historyHandoffIds?: ReadonlySet<string> | readonly (string | undefined | null)[];
  liveHistoryLen?: number;
}): HandoffLiveApplyDecision {
  const liveResp = responsibilityFromHandoffTask(params.live);
  const handoffId = compact(params.contract.handoffId);
  const ids = params.historyHandoffIds;
  const idSet =
    ids instanceof Set
      ? ids
      : new Set([...(ids ?? [])].map((v) => compact(v)).filter((v): v is string => Boolean(v)));
  if (handoffId && idSet.has(handoffId)) {
    return { kind: "idempotent", responsibility: liveResp };
  }
  const liveHistoryLen =
    typeof params.liveHistoryLen === "number"
      ? params.liveHistoryLen
      : Array.isArray(params.live.handoffs)
        ? params.live.handoffs.length
        : idSet.size;
  const baseHistoryLen = params.contract.baseHistoryLen;
  if (typeof baseHistoryLen === "number" && liveHistoryLen !== baseHistoryLen) {
    return {
      kind: "conflict",
      detail: `expected handoff history length ${baseHistoryLen}, live ${liveHistoryLen}`,
      responsibility: liveResp,
    };
  }
  const fromId = compact(params.contract.from.agentId);
  const toId = compact(params.contract.to.agentId);
  const role = params.contract.to.responsibilityRole;
  const isOwnerMove = params.contract.kind === "owner_transfer" || role === "owner";
  if (isOwnerMove) {
    if (compact(liveResp.owner) === toId) {
      return {
        kind: "already_at_target",
        detail: `live owner already ${toId}; handoff ${handoffId || "(missing)"} not in history`,
        responsibility: liveResp,
      };
    }
    if (compact(liveResp.owner) !== fromId) {
      return {
        kind: "conflict",
        detail: `expected owner ${fromId}, live owner ${liveResp.owner}`,
        responsibility: liveResp,
      };
    }
    return {
      kind: "apply",
      responsibility: applyHandoffContractToResponsibility(liveResp, params.contract),
    };
  }
  if (role === "reviewer") {
    if (compact(liveResp.reviewer) === toId) {
      return {
        kind: "already_at_target",
        detail: `live reviewer already ${toId}; handoff ${handoffId || "(missing)"} not in history`,
        responsibility: liveResp,
      };
    }
    if (liveResp.reviewer && compact(liveResp.reviewer) !== fromId) {
      return {
        kind: "conflict",
        detail: `expected reviewer ${fromId}, live reviewer ${liveResp.reviewer}`,
        responsibility: liveResp,
      };
    }
    return {
      kind: "apply",
      responsibility: applyHandoffContractToResponsibility(liveResp, params.contract),
    };
  }
  if (role === "approver") {
    if (compact(liveResp.approver) === toId) {
      return {
        kind: "already_at_target",
        detail: `live approver already ${toId}; handoff ${handoffId || "(missing)"} not in history`,
        responsibility: liveResp,
      };
    }
    if (liveResp.approver && compact(liveResp.approver) !== fromId) {
      return {
        kind: "conflict",
        detail: `expected approver ${fromId}, live approver ${liveResp.approver}`,
        responsibility: liveResp,
      };
    }
    return {
      kind: "apply",
      responsibility: applyHandoffContractToResponsibility(liveResp, params.contract),
    };
  }
  const executors = new Set(liveResp.executors.map((id) => compact(id)).filter(Boolean));
  if (executors.has(toId) && !executors.has(fromId)) {
    return {
      kind: "already_at_target",
      detail: `live executors already include ${toId} without ${fromId}; handoff ${handoffId || "(missing)"} not in history`,
      responsibility: liveResp,
    };
  }
  if (!executors.has(fromId)) {
    return {
      kind: "conflict",
      detail: `expected executor ${fromId} still assigned; live executors=[${[...executors].join(",")}]`,
      responsibility: liveResp,
    };
  }
  return {
    kind: "apply",
    responsibility: applyHandoffContractToResponsibility(liveResp, params.contract),
  };
}

export function appendHandoffHistoryById(
  existing: readonly TaskHandoff[] | null | undefined,
  entry: TaskHandoff,
): TaskHandoff[] {
  const prior = [...(existing ?? [])];
  const id = compact(entry.handoffId);
  if (id && prior.some((handoff) => compact(handoff.handoffId) === id)) {
    return prior;
  }
  return [...prior, entry];
}
