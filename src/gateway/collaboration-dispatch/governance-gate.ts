import type { EffectiveCollaborationPolicy } from "./effective-policy.js";

export type GovernanceGateAction = "finalize_decision" | "publish_proposal" | "self_advance";

export type GovernanceActorType = "human" | "bot";

export type GovernanceActor = {
  type: GovernanceActorType;
  id: string;
  governanceRole?: string | null;
};

export type GovernanceGateResult = {
  allowed: boolean;
  reason: string;
  message: string;
};

export type GovernanceMemberRoleLike = {
  memberId?: string | null;
  memberKind?: string | null;
  governanceRole?: string | null;
  collaborationRole?: string | null;
  label?: string | null;
};

function compactIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
}

export function classifyGovernanceActor(
  actorId: string | null | undefined,
  memberRoleMap?: readonly GovernanceMemberRoleLike[] | null,
): GovernanceActor {
  const id = actorId?.trim() ?? "";
  if (!id) {
    return { type: "human", id: "" };
  }
  const compact = compactIdentity(id);
  const matched = (memberRoleMap ?? []).find((member) => {
    const candidates = [member.memberId, member.label];
    return candidates.some((entry) => {
      const value = compactIdentity(entry);
      return (
        value === compact ||
        value === `human:${compact}` ||
        value === `bot:${compact}` ||
        value === `agent:${compact}` ||
        value.endsWith(`:${compact}`)
      );
    });
  });
  if (matched?.memberKind === "bot" || compact.startsWith("bot:") || compact.startsWith("agent:")) {
    return {
      type: "bot",
      id,
      governanceRole: matched?.governanceRole,
    };
  }
  return {
    type: "human",
    id,
    governanceRole: matched?.governanceRole,
  };
}

/**
 * Enforcement of EffectivePolicy.governance. Not a third rule source.
 */
export function evaluateGovernanceGate(params: {
  action: GovernanceGateAction;
  actor: GovernanceActor;
  effective: EffectiveCollaborationPolicy;
}): GovernanceGateResult {
  const { action, actor, effective } = params;
  if (actor.governanceRole === "observer") {
    return {
      allowed: false,
      reason: "observer_cannot_approve",
      message: "observers may read but cannot post, execute, or approve",
    };
  }

  if (action === "self_advance") {
    if (actor.type === "bot" && !effective.governance.botMaySelfAdvanceWithoutHuman) {
      return {
        allowed: false,
        reason: "bot_self_advance_disabled",
        message: "bots may not advance this group without a human",
      };
    }
    return {
      allowed: true,
      reason: "self_advance_allowed",
      message: "self-advance permitted",
    };
  }

  if (action === "publish_proposal") {
    if (actor.type !== "bot") {
      return {
        allowed: true,
        reason: "human_proposal_allowed",
        message: "human may publish a proposal",
      };
    }
    if (!effective.governance.allowAgentPublishProposal) {
      return {
        allowed: false,
        reason: "proposal_not_allowed",
        message: "bots may not publish proposals in this group",
      };
    }
    if (effective.governance.decisionMode === "human_required") {
      return {
        allowed: false,
        reason: "human_only_mode",
        message: "final decision policy requires a human before a bot can publish",
      };
    }
    return {
      allowed: true,
      reason: "proposal_allowed",
      message: "delegated proposal permitted",
    };
  }

  if (actor.type === "bot" && effective.governance.decisionMode === "human_required") {
    return {
      allowed: false,
      reason: "human_override_required",
      message: "final decision requires a human confirmation",
    };
  }

  return {
    allowed: true,
    reason: "authority_verified",
    message: "governance gate passed",
  };
}
