import {
  canActorPublishFinal,
  requiresHumanFinalDecision,
  type Decision,
  type FinalDecisionPolicy,
  type GroupProfile,
} from "@openbot/collaboration-core";
import type { GateResult, RuntimeActor } from "../contracts/runtime-coordinator.js";

type ProposalDecision = Decision & {
  type?: "proposal" | "final";
};

const DEFAULT_POLICY: FinalDecisionPolicy = {
  mode: "human_required",
  defaultFinalDeciderRole: "owner",
  allowAgentPublishProposal: false,
};

export function canPublishFinalDecision(params: {
  decisionId: string;
  actor: RuntimeActor;
  decision: Decision;
  groupProfile?: GroupProfile;
}): GateResult {
  const { actor, decision, groupProfile } = params;
  const policy = groupProfile?.finalDecisionPolicy ?? DEFAULT_POLICY;

  if (requiresHumanFinalDecision({ decision, policy }) && actor.type !== "human") {
    return {
      allowed: false,
      reason: "human_override_required",
      details: {
        decisionId: decision.decisionId,
        policyMode: policy.mode,
      },
    };
  }

  const actorContext = {
    subjectKind: actor.type === "bot" ? "runtime_node" : "gateway_client",
    memberId: actor.id,
  } as const;

  if (!canActorPublishFinal({ actor: actorContext, policy })) {
    return {
      allowed: false,
      reason: "insufficient_authority",
      details: {
        actorType: actor.type,
      },
    };
  }

  if (decision.status !== "draft") {
    return {
      allowed: false,
      reason: "invalid_status",
      details: {
        currentStatus: decision.status,
        requiredStatus: "draft",
      },
    };
  }

  return {
    allowed: true,
    reason: "authority_verified",
    details: {
      actorType: actor.type,
      policyMode: policy.mode,
    },
  };
}

export function canRuntimeNodePublishProposal(params: {
  actor: RuntimeActor;
  decision: ProposalDecision;
  groupProfile?: GroupProfile;
}): GateResult {
  const { actor, decision, groupProfile } = params;
  const policy = groupProfile?.finalDecisionPolicy ?? DEFAULT_POLICY;

  if (actor.type !== "bot") {
    return {
      allowed: false,
      reason: "not_runtime_node",
      details: {
        actorType: actor.type,
      },
    };
  }

  if (policy.mode !== "delegated_low_risk") {
    return {
      allowed: false,
      reason: "human_only_mode",
      details: {
        policyMode: policy.mode,
      },
    };
  }

  if (policy.allowAgentPublishProposal !== true) {
    return {
      allowed: false,
      reason: "proposal_not_allowed",
      details: {
        policyMode: policy.mode,
      },
    };
  }

  if (decision.type === "final") {
    return {
      allowed: false,
      reason: "cannot_publish_final",
      details: {
        decisionType: decision.type,
      },
    };
  }

  return {
    allowed: true,
    reason: "proposal_allowed",
    details: {
      policyMode: policy.mode,
    },
  };
}
