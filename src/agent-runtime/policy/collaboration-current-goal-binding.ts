import type { TaskResponsibility } from "./collaboration-policy-model.js";

/**
 * Current-goal / project-owner binding over existing Task + TaskResponsibility.
 * Briefs are read-only projections. This module does not create a second task store,
 * default auto-confirm mode, or a group-final delivery chain.
 */

export type KnownBindingMember = {
  id: string;
  name?: string | null;
  aliases?: readonly string[] | null;
};

export type AppointedProjectOwner = {
  ownerId: string;
  source: "explicit_field" | "appointment_language";
};

export type LaterBoundMessageKind =
  | "no_current_binding"
  | "read_only_query"
  | "clarification_bound"
  | "revision_bound"
  | "block_bound"
  | "new_work"
  | "no_followup_signal";

export type MemberContributionKind = "produce" | "block";

export type MemberContributionSource =
  | "member_self"
  | "role_play_text"
  | "main_answer_ghostwrite"
  | "plain_mention";

export type MemberContributionDecision =
  | { accepted: true; actorId: string; kind: MemberContributionKind }
  | {
      accepted: false;
      reason: "role_play_text" | "main_answer_ghostwrite" | "plain_mention" | "actor_mismatch";
    };

export type CollaborationWorkBriefInput = {
  goal: string;
  constraints?: readonly string[];
  completedSteps?: readonly string[];
  artifacts?: readonly { id: string; version: string }[];
  evidenceVersions?: readonly string[];
  responsibility: TaskResponsibility;
};

export type FirstStageAcceptanceHold = {
  kind: "not_ready" | "proactive_delivery" | "waiting_acceptance";
  autoAccept: false;
  authorizationWidened: false;
  memberAcceptCountsAsGroupFinal: false;
  groupFinalChainOpen: true;
};

const APPOINTMENT_LANGUAGE =
  /(?:任命|指定|请(?:让)?|设为|担任|appoint(?:ed)?(?:\s+as)?|make|name)\s*.{0,40}?(?:项目负责人|负责人|project\s+owner|owner)/iu;

const QUERY_LANGUAGE =
  /^(?:进度如何|现在怎样|现在怎么样|目前状态|查一下进度|问一下|怎么样了|what(?:'s| is) the status|how is it going)[\s。.?？!！]*$/iu;

const CLARIFY_CONFIRM_LANGUAGE =
  /(?:确认|就按这个|按这个(?:目标|方案|验收)|可以建立|补充验收|clarif(?:y|ication)|confirm(?:ed)?)/iu;

const REVISION_LANGUAGE =
  /(?:改成|改为|修订|调整目标|把截止日期|把交付日期|修改约束|revise|change the (?:goal|deadline|constraint))/iu;

const BLOCK_LANGUAGE = /(?:阻塞|被挡住|无法继续|blocked|cannot proceed)/iu;

const NEW_WORK_LANGUAGE =
  /(?:另外(?:再)?(?:做|建|开)|再开一个|新的项目|新任务|另作一个|start a new (?:task|project))/iu;

const ROLE_PLAY_LANGUAGE = /(?:我(?:来)?扮演|角色扮演|role[- ]?play|pretend (?:to be|I am))/iu;

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

function memberTokens(member: KnownBindingMember): string[] {
  return uniqueIds([member.id, compact(member.name) || "", ...(member.aliases ?? [])]);
}

function extractMentionedIds(message: string, members: readonly KnownBindingMember[]): string[] {
  const text = message;
  const found: string[] = [];
  const mentionRe = /@([^\s@,，。；;]+)/g;
  const mentions = [...text.matchAll(mentionRe)].map((match) => compact(match[1]));
  for (const member of members) {
    const tokens = memberTokens(member);
    if (
      tokens.some(
        (token) =>
          mentions.some((mention) => mention === token || mention === token.replace(/^bot:/, "")) ||
          text.includes(`@${token}`),
      )
    ) {
      found.push(member.id);
    }
  }
  return uniqueIds(found);
}

/**
 * Read an appointed project owner from an explicit field or appointment language.
 * A plain @mention without appointment wording is not an appointment.
 */
export function parseAppointedProjectOwner(params: {
  message?: string | null;
  appointedOwnerId?: string | null;
  knownMembers?: readonly KnownBindingMember[] | null;
}): AppointedProjectOwner | null {
  const explicit = compact(params.appointedOwnerId);
  if (explicit) {
    return { ownerId: explicit, source: "explicit_field" };
  }
  const message = compact(params.message);
  if (!message || !APPOINTMENT_LANGUAGE.test(message)) {
    return null;
  }
  const members = params.knownMembers ?? [];
  const mentioned = extractMentionedIds(message, members);
  if (mentioned.length === 1) {
    return { ownerId: mentioned[0], source: "appointment_language" };
  }
  for (const member of members) {
    const tokens = memberTokens(member);
    if (tokens.some((token) => token && message.includes(token))) {
      if (mentioned.length === 0 || mentioned.includes(member.id)) {
        return { ownerId: member.id, source: "appointment_language" };
      }
    }
  }
  return null;
}

/**
 * Authoritative responsibility for the current goal. Owner and standing group
 * coordinator are recorded as separate fields. The coordinator is never used
 * as a fallback owner.
 */
export function buildAuthoritativeResponsibility(params: {
  appointedOwnerId?: string | null;
  standingCoordinatorBotId?: string | null;
  createdBy?: string | null;
  existingOwnerMemberId?: string | null;
  existingResponsibility?: TaskResponsibility | null;
  assignedMemberIds?: readonly string[] | null;
}): TaskResponsibility {
  const appointed = compact(params.appointedOwnerId);
  const existingOwner = compact(
    params.existingResponsibility?.owner || params.existingOwnerMemberId,
  );
  const createdBy = compact(params.createdBy);
  const coordinator =
    compact(params.standingCoordinatorBotId) ||
    compact(params.existingResponsibility?.coordinator) ||
    undefined;
  const owner = appointed || existingOwner || createdBy || "group";
  const assigned = uniqueIds(params.assignedMemberIds ?? []);
  const executors =
    assigned.length > 0
      ? assigned
      : params.existingResponsibility?.executors
        ? uniqueIds(params.existingResponsibility.executors)
        : owner !== "group"
          ? [owner]
          : [];
  return {
    owner,
    executors,
    ...(params.existingResponsibility?.reviewer
      ? { reviewer: params.existingResponsibility.reviewer }
      : {}),
    ...(params.existingResponsibility?.approver
      ? { approver: params.existingResponsibility.approver }
      : {}),
    ...(coordinator ? { coordinator } : {}),
    decisionAuthority: params.existingResponsibility?.decisionAuthority || owner,
  };
}

/**
 * Later replies without a new appointment keep the bound owner.
 * Missing @ does not fall back to the standing coordinator.
 */
export function resolveOwnerAfterLaterMessage(params: {
  responsibility: TaskResponsibility;
  standingCoordinatorBotId?: string | null;
  laterMessage?: string | null;
  laterMentions?: readonly string[] | null;
  appointedOwnerId?: string | null;
  knownMembers?: readonly KnownBindingMember[] | null;
}): TaskResponsibility {
  const laterAppointment = parseAppointedProjectOwner({
    message: params.laterMessage,
    appointedOwnerId: params.appointedOwnerId,
    knownMembers: params.knownMembers,
  });
  void params.laterMentions;
  return buildAuthoritativeResponsibility({
    appointedOwnerId: laterAppointment?.ownerId,
    standingCoordinatorBotId:
      compact(params.standingCoordinatorBotId) || params.responsibility.coordinator,
    existingResponsibility: params.responsibility,
    existingOwnerMemberId: params.responsibility.owner,
    assignedMemberIds: params.responsibility.executors,
  });
}

export function classifyLaterBoundMessage(params: {
  currentGoal?: string | null;
  currentTaskId?: string | null;
  message: string;
}): LaterBoundMessageKind {
  const message = compact(params.message);
  const currentTaskId = compact(params.currentTaskId);
  const currentGoal = compact(params.currentGoal);
  if (!currentTaskId && !currentGoal) {
    return "no_current_binding";
  }
  if (!message) {
    return "read_only_query";
  }
  if (NEW_WORK_LANGUAGE.test(message) && currentGoal && !message.includes(currentGoal)) {
    return "new_work";
  }
  if (QUERY_LANGUAGE.test(message)) {
    return "read_only_query";
  }
  if (BLOCK_LANGUAGE.test(message)) {
    return "block_bound";
  }
  if (REVISION_LANGUAGE.test(message)) {
    return "revision_bound";
  }
  if (CLARIFY_CONFIRM_LANGUAGE.test(message)) {
    return "clarification_bound";
  }
  if (/[?？]$/.test(message) && !REVISION_LANGUAGE.test(message)) {
    return "read_only_query";
  }
  // A later explicit delegation or a changed contract is not a follow-up bind.
  // Those still go through the original mint / conflict / source-owner path.
  return "no_followup_signal";
}

export function shouldReuseCurrentGoalTask(kind: LaterBoundMessageKind): boolean {
  return kind === "clarification_bound" || kind === "revision_bound" || kind === "block_bound";
}

export function shouldStartNewFormalTask(kind: LaterBoundMessageKind): boolean {
  return kind === "no_current_binding" || kind === "new_work" || kind === "no_followup_signal";
}

/**
 * Read-only brief from authoritative records. Callers must not treat the
 * returned text as a mutable task state.
 */
export function projectCollaborationWorkBrief(
  input: CollaborationWorkBriefInput,
): string | undefined {
  const goal = compact(input.goal);
  if (!goal) {
    return undefined;
  }
  const lines = [
    "Bound collaboration work brief (authoritative projection, not a second task state):",
    `- Goal: ${goal}`,
    `- Project owner: ${input.responsibility.owner}`,
    input.responsibility.coordinator
      ? `- Group coordinator: ${input.responsibility.coordinator}`
      : undefined,
    input.responsibility.owner !== input.responsibility.coordinator
      ? "- Owner role and group-coordinator role are recorded separately."
      : undefined,
  ];
  const constraints = (input.constraints ?? []).map((item) => compact(item)).filter(Boolean);
  if (constraints.length > 0) {
    lines.push(`- Constraints: ${constraints.join("; ")}`);
  }
  const steps = (input.completedSteps ?? []).map((item) => compact(item)).filter(Boolean);
  if (steps.length > 0) {
    lines.push(`- Completed steps: ${steps.join("; ")}`);
  }
  const artifacts = (input.artifacts ?? []).filter(
    (item) => compact(item.id) && compact(item.version),
  );
  if (artifacts.length > 0) {
    lines.push(`- Artifacts: ${artifacts.map((item) => `${item.id}@${item.version}`).join("; ")}`);
  }
  const evidence = (input.evidenceVersions ?? []).map((item) => compact(item)).filter(Boolean);
  if (evidence.length > 0) {
    lines.push(`- Evidence versions: ${evidence.join("; ")}`);
  }
  return lines.filter(Boolean).join("\n");
}

export function classifyMemberContribution(params: {
  actorId: string;
  memberId: string;
  kind: MemberContributionKind;
  source: MemberContributionSource;
  text?: string | null;
}): MemberContributionDecision {
  const actorId = compact(params.actorId);
  const memberId = compact(params.memberId);
  if (!actorId || !memberId) {
    return { accepted: false, reason: "actor_mismatch" };
  }
  if (params.source === "role_play_text" || ROLE_PLAY_LANGUAGE.test(compact(params.text))) {
    return { accepted: false, reason: "role_play_text" };
  }
  if (params.source === "plain_mention") {
    return { accepted: false, reason: "plain_mention" };
  }
  if (params.source === "main_answer_ghostwrite") {
    return { accepted: false, reason: "main_answer_ghostwrite" };
  }
  if (actorId !== memberId) {
    return { accepted: false, reason: "actor_mismatch" };
  }
  return { accepted: true, actorId, kind: params.kind };
}

/**
 * After the owner integrates a first-stage result, deliver proactively but do
 * not auto-accept. A member accept is not group-final. The group-final chain
 * remains an open GAP.
 */
export function evaluateFirstStageAcceptanceHold(params: {
  ownerIntegrated: boolean;
  userAskedToWaitForAcceptance: boolean;
  memberAccepted?: boolean;
}): FirstStageAcceptanceHold {
  const base = {
    autoAccept: false as const,
    authorizationWidened: false as const,
    memberAcceptCountsAsGroupFinal: false as const,
    groupFinalChainOpen: true as const,
  };
  if (!params.ownerIntegrated) {
    return { kind: "not_ready", ...base };
  }
  void params.memberAccepted;
  if (params.userAskedToWaitForAcceptance) {
    return { kind: "waiting_acceptance", ...base };
  }
  return { kind: "proactive_delivery", ...base };
}
