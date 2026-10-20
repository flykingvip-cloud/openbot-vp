import type { GatewayBrowserClient } from "../gateway.ts";
import type { WorkbenchGovernanceObjectKind } from "../ports/employee/views/workbench-types.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";
import {
  loadCollaborationLearningSnapshot,
  type CollaborationLearningState,
} from "./collaboration-learning.ts";

export type CollaborationGovernanceActionState = CollaborationLearningState & {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  sessionsResult: SessionsListResult | null;
  workbenchDecisionSelectedOptionDraft?: string | null;
  workbenchDecisionRationaleDraft?: string | null;
  workbenchDecisionOptionsDraft?: Array<{ optionId: string; title: string }> | null;
  collaborationGovernanceActionBusyKey: string | null;
  collaborationGovernanceActionError: string | null;
};

export type CollaborationTaskHandoffDraft = {
  from: string;
  to: string;
  reason: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  completedArtifacts?: string[];
  assumptions?: string[];
  blockers?: string[];
};

export type CollaborationGovernanceTransitionParams = {
  kind: WorkbenchGovernanceObjectKind;
  id: string;
  toStatus: string;
  selectedOption?: string;
  handoff?: CollaborationTaskHandoffDraft;
};

function resolveActiveSessionRow(
  state: CollaborationGovernanceActionState,
): GatewaySessionRow | null {
  return state.sessionsResult?.sessions.find((entry) => entry.key === state.sessionKey) ?? null;
}

function resolveLearningScope(state: CollaborationGovernanceActionState) {
  const sessionRow = resolveActiveSessionRow(state);
  const groupId =
    sessionRow?.groupId?.trim() ||
    sessionRow?.collaborationGroupProfile?.groupId?.trim() ||
    sessionRow?.collaborationParticipationOverlay?.groupId?.trim() ||
    "";
  return groupId ? { groupId } : null;
}

function resolveMethodAndPayload(
  scope: { groupId: string },
  params: CollaborationGovernanceTransitionParams,
) {
  switch (params.kind) {
    case "task":
      if (params.handoff) {
        return {
          method: "collaboration.task.handoff",
          payload: {
            groupId: scope.groupId,
            taskId: params.id,
            from: params.handoff.from,
            to: params.handoff.to,
            reason: params.handoff.reason,
            remainingWork: params.handoff.remainingWork,
            acceptanceCriteria: params.handoff.acceptanceCriteria,
            ...(params.handoff.completedArtifacts
              ? { completedArtifacts: params.handoff.completedArtifacts }
              : {}),
            ...(params.handoff.assumptions ? { assumptions: params.handoff.assumptions } : {}),
            ...(params.handoff.blockers ? { blockers: params.handoff.blockers } : {}),
          },
        };
      }
      return {
        method: "collaboration.task.transition",
        payload: { groupId: scope.groupId, taskId: params.id, toStatus: params.toStatus },
      };
    case "deliverable":
      return {
        method: "collaboration.deliverable.transition",
        payload: {
          groupId: scope.groupId,
          deliverableId: params.id,
          toStatus: params.toStatus,
        },
      };
    case "review":
      return {
        method: "collaboration.review.transition",
        payload: { groupId: scope.groupId, reviewId: params.id, toStatus: params.toStatus },
      };
    case "decision":
      return {
        method: "collaboration.decision.transition",
        payload: {
          groupId: scope.groupId,
          decisionId: params.id,
          toStatus: params.toStatus,
          ...(params.selectedOption ? { selectedOption: params.selectedOption } : {}),
        },
      };
    case "capsule":
      // 经验胶囊治理审批：toStatus 为 "approved" | "revoked"（见 capsule-governance.ts）。
      return {
        method: "collaboration.capsule.transition",
        payload: {
          groupId: scope.groupId,
          capsuleId: params.id,
          toStatus: params.toStatus,
          ...(params.toStatus === "approved" ? { reusability: "promotable" as const } : {}),
        },
      };
  }
}

export function resetCollaborationGovernanceActionState(state: CollaborationGovernanceActionState) {
  state.collaborationGovernanceActionBusyKey = null;
  state.collaborationGovernanceActionError = null;
}

export async function transitionCollaborationGovernanceObject(
  state: CollaborationGovernanceActionState,
  params: CollaborationGovernanceTransitionParams,
) {
  if (!state.client || !state.connected) {
    return;
  }
  const scope = resolveLearningScope(state);
  if (!scope) {
    return;
  }
  const busyKey = params.handoff
    ? `${params.kind}:${params.id}:handoff`
    : `${params.kind}:${params.id}:${params.toStatus}`;
  const { method, payload } = resolveMethodAndPayload(scope, params);
  state.collaborationGovernanceActionBusyKey = busyKey;
  state.collaborationGovernanceActionError = null;
  try {
    const result = await state.client.request<{
      capsule?: { capsuleId?: string; status?: string };
      promotion?: { promoted?: boolean; reason?: string; assetId?: string; projectionId?: string };
    }>(method, payload);
    if (params.kind === "capsule" && params.toStatus === "approved") {
      const promotion = result?.promotion;
      if (promotion && promotion.promoted === false) {
        state.collaborationGovernanceActionError = `Capsule approved but not promoted: ${promotion.reason ?? "unknown reason"}`;
      }
    }
    await loadCollaborationLearningSnapshot(state, { force: true });
  } catch (error) {
    state.collaborationGovernanceActionError = String(error);
  } finally {
    state.collaborationGovernanceActionBusyKey = null;
  }
}

export async function saveCollaborationDecisionDraft(
  state: CollaborationGovernanceActionState,
  params: {
    id: string;
    rationale?: string;
    selectedOption?: string;
    options?: Array<{ optionId: string; title: string }>;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const scope = resolveLearningScope(state);
  if (!scope) {
    return;
  }
  const busyKey = `decision-save:${params.id}`;
  state.collaborationGovernanceActionBusyKey = busyKey;
  state.collaborationGovernanceActionError = null;
  try {
    await state.client.request("collaboration.decision.updateDraft", {
      groupId: scope.groupId,
      decisionId: params.id,
      ...(params.rationale !== undefined ? { rationale: params.rationale } : {}),
      ...(params.selectedOption !== undefined ? { selectedOption: params.selectedOption } : {}),
      ...(params.options !== undefined ? { options: params.options } : {}),
    });
    await loadCollaborationLearningSnapshot(state, { force: true });
    state.workbenchDecisionSelectedOptionDraft = null;
    state.workbenchDecisionRationaleDraft = null;
    state.workbenchDecisionOptionsDraft = null;
  } catch (error) {
    state.collaborationGovernanceActionError = String(error);
  } finally {
    state.collaborationGovernanceActionBusyKey = null;
  }
}
