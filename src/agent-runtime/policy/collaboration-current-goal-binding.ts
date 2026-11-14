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

/** Appointment-speech polarity only; not a general NLP classifier. */
const APPOINTMENT_NEGATION =
  /(?:不要|别|勿|禁止|取消|并非要|不是要|先不要|don't|do\s+not|never)\s*(?:再)?\s*(?:任命|指定|设为|担任|appoint)/iu;

const UNSETTLED_APPOINTMENT = /(?:先等我确定|等我确定人选|还没确定|尚未确定|待定人选|先不确定)/iu;

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

export type AppointmentSpeech = "none" | "appoint" | "negated" | "unsettled";

export type AppointmentProposal = {
  source: "explicit_field" | "appointment_language" | "none";
  speech: AppointmentSpeech;
  candidateIds: string[];
};

export type RosterReadStatus =
  | { ok: true; members: readonly KnownBindingMember[] }
  | { ok: false; reason: "unreadable" };

/**
 * Interaction wording and caller fields are only an appointment proposal.
 * The host must authorize this against the current server-side member table.
 */
export function proposeAppointedProjectOwner(params: {
  message?: string | null;
  appointedOwnerId?: string | null;
  knownMembers?: readonly KnownBindingMember[] | null;
}): AppointmentProposal {
  const explicit = compact(params.appointedOwnerId);
  const message = compact(params.message);
  const members = params.knownMembers ?? [];
  const mentioned = message ? extractMentionedIds(message, members) : [];
  if (message && APPOINTMENT_NEGATION.test(message)) {
    return {
      source: explicit ? "explicit_field" : "appointment_language",
      speech: "negated",
      candidateIds: uniqueIds([...mentioned, explicit]),
    };
  }
  if (explicit) {
    if (message && (UNSETTLED_APPOINTMENT.test(message) || mentioned.length > 1)) {
      return {
        source: "explicit_field",
        speech: "unsettled",
        candidateIds: uniqueIds([explicit, ...mentioned]),
      };
    }
    return { source: "explicit_field", speech: "appoint", candidateIds: [explicit] };
  }
  if (!message || !APPOINTMENT_LANGUAGE.test(message)) {
    return { source: "none", speech: "none", candidateIds: [] };
  }
  // A plain @mention without appointment wording never reaches here.
  // Multiple mentions or an explicit pending choice stay unsettled; do not pick
  // the first member from the roster order.
  if (UNSETTLED_APPOINTMENT.test(message) || mentioned.length !== 1) {
    return {
      source: "appointment_language",
      speech: "unsettled",
      candidateIds: mentioned,
    };
  }
  return {
    source: "appointment_language",
    speech: "appoint",
    candidateIds: mentioned,
  };
}

function memberMatchesIdentity(member: KnownBindingMember, candidate: string): boolean {
  const wanted = compact(candidate);
  if (!wanted) {
    return false;
  }
  const tokens = memberTokens(member);
  return tokens.some(
    (token) =>
      token === wanted ||
      token === wanted.replace(/^bot:/, "") ||
      wanted === token.replace(/^bot:/, ""),
  );
}

/**
 * Approve a proposal only against a successfully read trusted member table.
 * A read failure or alias collision does not write an owner and does not fall
 * back to a human or standing coordinator.
 */
export function authorizeAppointedProjectOwner(params: {
  proposal: AppointmentProposal;
  roster: RosterReadStatus;
}): AppointedProjectOwner | null {
  if (!params.roster.ok) {
    return null;
  }
  if (params.proposal.speech !== "appoint" || params.proposal.candidateIds.length !== 1) {
    return null;
  }
  const candidate = params.proposal.candidateIds[0];
  const matches = params.roster.members.filter((member) =>
    memberMatchesIdentity(member, candidate),
  );
  if (matches.length !== 1) {
    return null;
  }
  return {
    ownerId: matches[0].id,
    source: params.proposal.source === "explicit_field" ? "explicit_field" : "appointment_language",
  };
}

/**
 * Convenience for callers that already hold a trusted member table.
 * Without that table, caller fields are not treated as verified.
 */
export function parseAppointedProjectOwner(params: {
  message?: string | null;
  appointedOwnerId?: string | null;
  knownMembers?: readonly KnownBindingMember[] | null;
}): AppointedProjectOwner | null {
  const proposal = proposeAppointedProjectOwner(params);
  if (params.knownMembers == null) {
    return null;
  }
  return authorizeAppointedProjectOwner({
    proposal,
    roster: { ok: true, members: params.knownMembers },
  });
}

export function bindingMembersFromRoster(
  roster: readonly {
    memberId?: string | null;
    agentId?: string | null;
    userId?: string | null;
    name?: string | null;
    status?: string | null;
  }[],
): KnownBindingMember[] {
  const out: KnownBindingMember[] = [];
  for (const member of roster) {
    if (member.status && member.status !== "active") {
      continue;
    }
    const id = compact(member.agentId) || compact(member.userId) || compact(member.memberId);
    if (!id) {
      continue;
    }
    out.push({
      id,
      name: member.name ?? null,
      aliases: [compact(member.memberId), compact(member.agentId), compact(member.userId)].filter(
        Boolean,
      ),
    });
  }
  return out;
}

/** Legal organizer is the bound project owner. The standing coordinator is not a fallback. */
export function legalOrganizerId(responsibility: TaskResponsibility): string {
  return compact(responsibility.owner);
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

export type LaterMessageSpeech =
  | "read_only_query"
  | "clarification"
  | "revision"
  | "block"
  | "new_work"
  | "no_followup_signal";

export function classifyLaterMessageSpeech(messageText: string): LaterMessageSpeech {
  const message = compact(messageText);
  if (!message) {
    return "read_only_query";
  }
  if (NEW_WORK_LANGUAGE.test(message)) {
    return "new_work";
  }
  if (QUERY_LANGUAGE.test(message)) {
    return "read_only_query";
  }
  if (BLOCK_LANGUAGE.test(message)) {
    return "block";
  }
  if (REVISION_LANGUAGE.test(message)) {
    return "revision";
  }
  if (CLARIFY_CONFIRM_LANGUAGE.test(message)) {
    return "clarification";
  }
  if (/[?？]$/.test(message) && !REVISION_LANGUAGE.test(message)) {
    return "read_only_query";
  }
  return "no_followup_signal";
}

export function classifyLaterBoundMessage(params: {
  currentGoal?: string | null;
  currentTaskId?: string | null;
  message: string;
}): LaterBoundMessageKind {
  const message = compact(params.message);
  const currentTaskId = compact(params.currentTaskId);
  const currentGoal = compact(params.currentGoal);
  const speech = classifyLaterMessageSpeech(message);
  if (!currentTaskId && !currentGoal) {
    return "no_current_binding";
  }
  if (speech === "new_work" && currentGoal && !message.includes(currentGoal)) {
    return "new_work";
  }
  if (speech === "read_only_query") {
    return "read_only_query";
  }
  if (speech === "block") {
    return "block_bound";
  }
  if (speech === "revision") {
    return "revision_bound";
  }
  if (speech === "clarification") {
    return "clarification_bound";
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

export const FIRST_STAGE_HOLD_TAG_PREFIX = "s5-acceptance-hold:";

export function firstStageHoldTag(kind: FirstStageAcceptanceHold["kind"]): string {
  return `${FIRST_STAGE_HOLD_TAG_PREFIX}${kind}`;
}

export function readFirstStageHoldFromTags(
  tags: readonly string[] | null | undefined,
): FirstStageAcceptanceHold["kind"] | null {
  for (const tag of tags ?? []) {
    const value = compact(tag);
    if (!value.startsWith(FIRST_STAGE_HOLD_TAG_PREFIX)) {
      continue;
    }
    const kind = value.slice(FIRST_STAGE_HOLD_TAG_PREFIX.length);
    if (kind === "not_ready" || kind === "proactive_delivery" || kind === "waiting_acceptance") {
      return kind;
    }
  }
  return null;
}

export function mergeFirstStageHoldTag(
  tags: readonly string[] | null | undefined,
  kind: FirstStageAcceptanceHold["kind"],
): string[] {
  const kept = [...(tags ?? [])].filter(
    (tag) => !compact(tag).startsWith(FIRST_STAGE_HOLD_TAG_PREFIX),
  );
  return [...kept, firstStageHoldTag(kind)];
}

export function isFirstStageAcceptanceHoldBlocking(
  kind: FirstStageAcceptanceHold["kind"] | null,
): boolean {
  return kind === "waiting_acceptance";
}

export type LiveBindingTask = {
  taskId: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  goal?: string | null;
};

export type GoalBindingResolution =
  | { kind: "unique"; taskId: string; goal: string }
  | {
      kind: "clarify";
      reason: "no_unique_target" | "state_read_failed" | "target_replaced_or_cancelled";
    };

const TERMINAL_BINDING_STATUSES = new Set(["completed", "cancelled"]);

function referredGoalPhrases(message: string): string[] {
  const phrases: string[] = [];
  const re = /(?:针对|关于|对于)\s*([^\s,，。；;：:]+)/g;
  for (const match of message.matchAll(re)) {
    const phrase = compact(match[1]);
    if (phrase) {
      phrases.push(phrase);
    }
  }
  return uniqueIds(phrases);
}

function taskIdentityTexts(task: LiveBindingTask): string[] {
  return uniqueIds([
    compact(task.taskId),
    compact(task.title),
    compact(task.description),
    compact(task.goal),
  ]);
}

function taskMatchesPhrase(task: LiveBindingTask, phrase: string): boolean {
  const wanted = compact(phrase);
  if (!wanted) {
    return false;
  }
  return taskIdentityTexts(task).some((text) => text.includes(wanted));
}

function isLiveBindingTask(task: LiveBindingTask): boolean {
  const status = compact(task.status);
  return !status || !TERMINAL_BINDING_STATUSES.has(status);
}

/**
 * Bind a later message to a unique authoritative goal. Never use updatedAt
 * order or the first live task as a guess. A read failure does not mint work.
 */
export function resolveAuthoritativeGoalBinding(params: {
  message: string;
  activeContext?: { currentTaskId?: string | null; currentMission?: string | null } | null;
  tasks: readonly LiveBindingTask[] | null;
  understandingGoal?: string | null;
}): GoalBindingResolution {
  if (params.tasks == null) {
    return { kind: "clarify", reason: "state_read_failed" };
  }
  const message = compact(params.message);
  const live = params.tasks.filter((task) => compact(task.taskId) && isLiveBindingTask(task));
  const terminal = params.tasks.filter((task) => compact(task.taskId) && !isLiveBindingTask(task));
  const phrases = referredGoalPhrases(message);
  if (phrases.length > 0) {
    const liveMatches = uniqueIds(
      live
        .filter((task) => phrases.some((phrase) => taskMatchesPhrase(task, phrase)))
        .map((task) => task.taskId),
    );
    if (liveMatches.length === 1) {
      const task = live.find((item) => item.taskId === liveMatches[0])!;
      return {
        kind: "unique",
        taskId: task.taskId,
        goal:
          compact(task.goal) ||
          compact(task.title) ||
          compact(task.description) ||
          compact(params.understandingGoal) ||
          task.taskId,
      };
    }
    const terminalMatches = uniqueIds(
      terminal
        .filter((task) => phrases.some((phrase) => taskMatchesPhrase(task, phrase)))
        .map((task) => task.taskId),
    );
    if (liveMatches.length === 0 && terminalMatches.length > 0) {
      return { kind: "clarify", reason: "target_replaced_or_cancelled" };
    }
    return { kind: "clarify", reason: "no_unique_target" };
  }
  const currentId = compact(params.activeContext?.currentTaskId);
  if (currentId) {
    const current = live.find((task) => task.taskId === currentId);
    if (current) {
      return {
        kind: "unique",
        taskId: current.taskId,
        goal:
          compact(current.goal) ||
          compact(params.activeContext?.currentMission) ||
          compact(current.title) ||
          compact(params.understandingGoal) ||
          current.taskId,
      };
    }
    const replaced = terminal.find((task) => task.taskId === currentId);
    if (replaced) {
      return { kind: "clarify", reason: "target_replaced_or_cancelled" };
    }
  }
  if (live.length === 1) {
    const task = live[0];
    return {
      kind: "unique",
      taskId: task.taskId,
      goal:
        compact(task.goal) ||
        compact(task.title) ||
        compact(params.understandingGoal) ||
        task.taskId,
    };
  }
  return { kind: "clarify", reason: "no_unique_target" };
}

/**
 * Classify a member contribution from server-side member / run / artifact
 * identities. A self-reported source is ignored.
 */
export function classifyAuthoritativeMemberContribution(params: {
  actorId: string;
  memberId: string;
  kind: MemberContributionKind;
  runOwnerId?: string | null;
  artifactAuthorId?: string | null;
  memberStatus?: string | null;
  text?: string | null;
}): MemberContributionDecision {
  const actorId = compact(params.actorId);
  const memberId = compact(params.memberId);
  const runOwnerId = compact(params.runOwnerId) || actorId;
  const artifactAuthorId = compact(params.artifactAuthorId) || actorId;
  if (!actorId || !memberId) {
    return { accepted: false, reason: "actor_mismatch" };
  }
  if (params.memberStatus && params.memberStatus !== "active") {
    return { accepted: false, reason: "actor_mismatch" };
  }
  if (ROLE_PLAY_LANGUAGE.test(compact(params.text))) {
    return { accepted: false, reason: "role_play_text" };
  }
  if (actorId !== memberId || actorId !== runOwnerId || actorId !== artifactAuthorId) {
    return { accepted: false, reason: "actor_mismatch" };
  }
  return { accepted: true, actorId, kind: params.kind };
}
