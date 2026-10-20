import type { Decision } from "../types/decision.js";
import type { CollaborationMember } from "../types/member.js";
import type { FinalDecisionPolicy, GroupProfile } from "../types/profile.js";

export type ActorContext = {
  subjectKind?: "control_ui_port" | "gateway_client" | "gateway_device" | "runtime_node";
  memberId?: string;
  member?: CollaborationMember;
};

export function canActorPublishFinal(params: {
  actor: ActorContext;
  policy?: FinalDecisionPolicy;
}): boolean {
  const { actor, policy } = params;
  if (actor.subjectKind === "runtime_node") {
    return policy?.mode === "delegated_low_risk";
  }
  return true;
}

export function resolveFinalDecisionMode(profile: GroupProfile): FinalDecisionPolicy {
  return (
    profile.finalDecisionPolicy ?? {
      mode: "human_required",
      defaultFinalDeciderRole: "owner",
      allowAgentPublishProposal: false,
    }
  );
}

export function requiresHumanFinalDecision(params: {
  decision: Decision;
  policy: FinalDecisionPolicy;
}): boolean {
  const { decision, policy } = params;
  if (policy.mode === "human_required") {
    return true;
  }
  return !decision.deciderMemberId;
}

export function canMemberActAsFinalDecider(params: {
  member: CollaborationMember;
  policy: FinalDecisionPolicy;
}): boolean {
  const { member, policy } = params;
  if (policy.defaultFinalDeciderRole === "owner") {
    return member.governanceRole === "owner";
  }
  if (policy.defaultFinalDeciderRole === "admin") {
    return member.governanceRole === "owner" || member.governanceRole === "admin";
  }
  return false;
}

export function canAgentPublishProposal(params: {
  member: CollaborationMember;
  policy: FinalDecisionPolicy;
}): boolean {
  const { member, policy } = params;
  if (member.memberKind !== "bot") {
    return false;
  }
  return policy.allowAgentPublishProposal;
}
