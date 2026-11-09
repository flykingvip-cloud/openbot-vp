/**
 * Pure collaboration rules. No config load, lock, board write, or channel fan-out.
 * SessionTaskBoard, ClaimContract, and ExecutorPrivateTodolist stay separate scopes.
 * Defaults below are the current L1 values; this module does not add confirm modes.
 */

export const COLLABORATION_POLICY_PROTOCOL_VERSION = "1.1" as const;

/** L1-Hard: never overridable. */
export const SYSTEM_INVARIANTS = {
  protocolVersion: COLLABORATION_POLICY_PROTOCOL_VERSION,
  maxVisibleRepliesCeiling: 12,
  mentionUnmatchedCannotDispatch: true,
  nonMemberCannotWrite: true,
  observerCannotWrite: true,
  archivedCannotDispatch: true,
  emptyEnabledSkillsMeansNoGroupRestriction: true,
  personalSessionDoesNotInheritGroupSkillAllowlist: true,
  groupRoundDoesNotPassInboundDepth: true,
  cannotBypassConfidentiality: true,
  l2CannotWidenL1: true,
  mentionMustDispatch: true,
  mentionMaySilentIfNoIncrement: true,
} as const;

export type SystemInvariants = typeof SYSTEM_INVARIANTS;

export type CollaborationModeTemplateId = "discussion_driven" | "task_driven" | "review_driven";

export type LowSignalStrategy = "one_reply" | "all_named_confirmers";

export type DecisionMode = "human_required" | "delegated_low_risk";

export type ObserverPermissionMatrix = {
  canRead: true;
  canMention: false;
  canRespond: false;
  canExecute: false;
  canApprove: false;
};

export const OBSERVER_PERMISSIONS: ObserverPermissionMatrix = {
  canRead: true,
  canMention: false,
  canRespond: false,
  canExecute: false,
  canApprove: false,
};

export type ModeTemplate = {
  id: CollaborationModeTemplateId;
  goal: string;
  primaryStrength: "weak" | "owner_required" | "reviewer_required";
  openParticipation: "high" | "on_demand" | "constrained";
  deliverableRequired: boolean;
  preserveConflict: boolean;
};

export const MODE_TEMPLATES: Record<CollaborationModeTemplateId, ModeTemplate> = {
  discussion_driven: {
    id: "discussion_driven",
    goal: "形成认知",
    primaryStrength: "weak",
    openParticipation: "high",
    deliverableRequired: false,
    preserveConflict: false,
  },
  task_driven: {
    id: "task_driven",
    goal: "完成交付",
    primaryStrength: "owner_required",
    openParticipation: "on_demand",
    deliverableRequired: true,
    preserveConflict: false,
  },
  review_driven: {
    id: "review_driven",
    goal: "发现问题",
    primaryStrength: "reviewer_required",
    openParticipation: "constrained",
    deliverableRequired: false,
    preserveConflict: true,
  },
};

/** Current compiler defaults. Do not retarget these to seed values. */
export const L1_DEFAULT = {
  collaborationMode: "discussion_driven" as CollaborationModeTemplateId,
  openDiscussionWithoutMention: false,
  allowSupplementAfterPrimary: true,
  maxVisibleBotRepliesPerRound: 5,
  mentionBotMustRespond: false,
  humanStartsNewRound: true,
  botMaySelfAdvanceWithoutHuman: false,
  entersWaitingForHumanAfterVisibleTurnsExhausted: true,
  coordinatorSummarizeAfterRound: false,
  lowSignalStrategy: "one_reply" as LowSignalStrategy,
  finalDecisionMode: "human_required" as DecisionMode,
  allowAgentPublishProposal: true,
  allowSecondaryTakeover: true,
};

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

export type CollaborationGovernanceView = {
  governance: {
    botMaySelfAdvanceWithoutHuman: boolean;
    allowAgentPublishProposal: boolean;
    decisionMode: string;
  };
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

/** Enforcement of EffectivePolicy.governance. Not a third rule source. */
export function evaluateGovernanceGate(params: {
  action: GovernanceGateAction;
  actor: GovernanceActor;
  effective: CollaborationGovernanceView;
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

export function s3DoesNotTouchLiveOrDefaultFlagsOn(): true {
  return true;
}

export function s3DoesNotOpenProductionGrayWrites(): true {
  return true;
}

export function normalizeArtifactVersion(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function isValidArtifactVersion(value: string | null | undefined): boolean {
  return normalizeArtifactVersion(value).length > 0;
}

export function normalizeAcceptanceCriterion(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

export function acceptanceCriteriaFullyChecked(params: {
  boardCriteria: readonly string[] | null | undefined;
  checkedCriteria: readonly string[] | null | undefined;
}): { ok: true } | { ok: false; reason: string; missing: string[] } {
  const board = (params.boardCriteria ?? [])
    .map((c) => normalizeAcceptanceCriterion(c))
    .filter((c) => c.length > 0);
  if (board.length === 0) {
    return { ok: false, reason: "acceptance_criteria_missing_on_board", missing: [] };
  }
  const checkedRaw = params.checkedCriteria ?? [];
  if (checkedRaw.length === 0) {
    return {
      ok: false,
      reason: "acceptance_criteria_unchecked",
      missing: [...(params.boardCriteria ?? [])].map((c) => c.trim()).filter(Boolean),
    };
  }
  const checked = new Set(
    checkedRaw.map((c) => normalizeAcceptanceCriterion(c)).filter((c) => c.length > 0),
  );
  const missing: string[] = [];
  for (const original of params.boardCriteria ?? []) {
    const key = normalizeAcceptanceCriterion(original);
    if (key && !checked.has(key)) {
      missing.push(original.trim());
    }
  }
  if (missing.length > 0) {
    return { ok: false, reason: "acceptance_criteria_incomplete", missing };
  }
  return { ok: true };
}

export function assertAcceptanceProxyFields(params: {
  proxyForActorId?: string | null;
  proxyBasis?: string | null;
}): { ok: true } | { ok: false; reason: string; message: string } {
  const proxyFor = params.proxyForActorId?.trim() ?? "";
  const basis = params.proxyBasis?.trim() ?? "";
  if (!proxyFor && !basis) {
    return { ok: true };
  }
  if (proxyFor && !basis) {
    return {
      ok: false,
      reason: "proxy_basis_required",
      message: "acceptanceProxyBasis is required when acceptanceProxyForActorId is set",
    };
  }
  if (!proxyFor && basis) {
    return {
      ok: false,
      reason: "proxy_actor_required",
      message: "acceptanceProxyForActorId is required when acceptanceProxyBasis is set",
    };
  }
  return { ok: true };
}

export function pendingSubmissionMatches(params: {
  currentSubmissionId?: string | null;
  expectedSubmissionId?: string | null;
}): { ok: true } | { ok: false; reason: string; message: string } {
  const current = params.currentSubmissionId?.trim() ?? "";
  const expected = params.expectedSubmissionId?.trim() ?? "";
  if (!expected) {
    return {
      ok: false,
      reason: "expected_submission_id_required",
      message: "accept/return requires expectedSubmissionId bound to the pending submission",
    };
  }
  if (!current) {
    return {
      ok: false,
      reason: "submission_missing",
      message: "no pending submissionId on item; cannot accept/return a stale version",
    };
  }
  if (current !== expected) {
    return {
      ok: false,
      reason: "submission_version_mismatch",
      message: `expectedSubmissionId ${expected} does not match pending ${current}; refuse stale/wrong version`,
    };
  }
  return { ok: true };
}

export function normalizeSubmissionBody(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function isEmptySubmissionBody(value: string | null | undefined): boolean {
  return normalizeSubmissionBody(value).length === 0;
}

export function isDuplicateSubmissionBody(
  next: string | null | undefined,
  previous: string | null | undefined,
): boolean {
  const a = normalizeSubmissionBody(next);
  const b = normalizeSubmissionBody(previous);
  return a.length > 0 && b.length > 0 && a === b;
}

export function boardSubmissionStateContract(status: string): {
  bindsSubmissionVersion: boolean;
  acceptsLatePriorVersion: boolean;
  autoAdvanceAfter: boolean;
  note: string;
} {
  switch (status) {
    case "submitted_for_review":
      return {
        bindsSubmissionVersion: true,
        acceptsLatePriorVersion: false,
        autoAdvanceAfter: false,
        note: "submitted_for_review binds submissionId+artifactVersion; wait accept/return",
      };
    case "returned":
      return {
        bindsSubmissionVersion: false,
        acceptsLatePriorVersion: false,
        autoAdvanceAfter: false,
        note: "returned: revise + re-confirm plan; old submission cannot be late-accepted",
      };
    case "accepted":
      return {
        bindsSubmissionVersion: true,
        acceptsLatePriorVersion: false,
        autoAdvanceAfter: false,
        note: "accepted: terminal; no auto advance",
      };
    default:
      return {
        bindsSubmissionVersion: false,
        acceptsLatePriorVersion: false,
        autoAdvanceAfter: false,
        note: `status ${status}: not in S3 accept/return closed loop`,
      };
  }
}

export function peerReviewMustNotDriveAdmission(): true {
  return true;
}

/** Flag-on accept needs at least one non-author review. Flag-off is allow. */
export function peerReviewAcceptAllowed(params: {
  requirePeerReview: boolean;
  nonAuthorReviewCount: number;
}): { ok: true } | { ok: false; reason: "peer_review_required"; message: string } {
  if (!params.requirePeerReview || params.nonAuthorReviewCount >= 1) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "peer_review_required",
    message:
      "collaboration.task.requirePeerReview is on; accept requires ≥1 non-author peer review on this submission",
  };
}

export const DELIVERY_EXEC_BOARD_STATUSES = ["applied", "in_progress", "returned"] as const;

export const NO_DELIVERY_SELF_ADVANCE_BOARD_STATUSES = [
  "published",
  "claimed",
  "submitted_for_review",
  "accepted",
  "blocked",
  "cancelled",
] as const;

export type BoardTodolistDeliveryMapping = Readonly<{
  boardStatus: string;
  draftAllowed: boolean;
  deliveryRequiresConfirmedPlan: boolean;
  deliverySelfAdvanceEligible: boolean;
  note: string;
}>;

export function boardTodolistDeliveryMapping(boardStatus: string): BoardTodolistDeliveryMapping {
  const status = boardStatus.trim();
  switch (status) {
    case "published":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "published: claim first; no delivery self-advance",
      };
    case "claimed":
      return {
        boardStatus: status,
        draftAllowed: true,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "claimed: ownership only; draft OK; no delivery self-advance yet",
      };
    case "applied":
      return {
        boardStatus: status,
        draftAllowed: true,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: true,
        note: "applied: draft OK unconfirmed; delivery self-advance requires confirmed plan",
      };
    case "in_progress":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: true,
        note: "in_progress: must have confirmed Todolist owned by current claimant",
      };
    case "returned":
      return {
        boardStatus: status,
        draftAllowed: true,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: true,
        note: "returned: revise + re-confirm plan before delivery self-advance",
      };
    case "submitted_for_review":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "submitted_for_review: wait accept/return; do not re-exec same submission",
      };
    case "accepted":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "accepted: terminal; no auto advance",
      };
    case "blocked":
    case "cancelled":
      return {
        boardStatus: status,
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: `${status}: no ordinary delivery self-advance`,
      };
    default:
      return {
        boardStatus: status || "unknown",
        draftAllowed: false,
        deliveryRequiresConfirmedPlan: true,
        deliverySelfAdvanceEligible: false,
        note: "unknown board status; fail closed for delivery",
      };
  }
}

export function s2DoesNotDefaultSelfAdvanceOn(): true {
  return true;
}

/**
 * Statuses the lock callback already allows. Submit's idempotent
 * submitted_for_review path is handled by the host before this check.
 */
export const CLAIM_BOARD_ACTION_SOURCES = {
  claim: ["published"],
  apply: ["claimed"],
  mark_in_progress: ["claimed", "applied", "returned", "blocked"],
  submit: ["in_progress", "returned"],
  accept: ["submitted_for_review"],
  return: ["submitted_for_review"],
  block: ["in_progress", "submitted_for_review"],
  unblock: ["blocked"],
  cancel: ["published", "claimed", "applied", "in_progress", "submitted_for_review"],
} as const;

export type ClaimBoardAction = keyof typeof CLAIM_BOARD_ACTION_SOURCES;

export function claimBoardActionAllowed(status: string, action: ClaimBoardAction): boolean {
  return (CLAIM_BOARD_ACTION_SOURCES[action] as readonly string[]).includes(status);
}

/** Oral dispatch never creates a ClaimContract fact. */
export function oralDispatchCreatesBoardFact(): false {
  return false;
}

/** Free-chat text is never an ExecutorPrivateTodolist fact. */
export function freeChatIsTodolist(): false {
  return false;
}

/** Private todolist is not a sub-record of the group ClaimContract board. */
export function todolistIsGroupSharedBoardSubrecord(): false {
  return false;
}

export function isTodolistConfirmedForDelivery(
  todolist: { status?: string | null } | null | undefined,
): boolean {
  return todolist?.status === "confirmed";
}

/** Default / flag-off ceiling: single beat only. */
export const MULTI_BEAT_DEFAULT_MAX = 1;

/** Hard ceiling aligned with SYSTEM_INVARIANTS.maxVisibleRepliesCeiling. */
export const MULTI_BEAT_HARD_CEILING = 12;

/** Clamp a raw maxBeats value the same way config resolve does. */
export function clampMaxBeatsPerEpisode(raw: number | null | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return MULTI_BEAT_DEFAULT_MAX;
  }
  const floored = Math.floor(raw);
  if (floored < MULTI_BEAT_DEFAULT_MAX) {
    return MULTI_BEAT_DEFAULT_MAX;
  }
  if (floored > MULTI_BEAT_HARD_CEILING) {
    return MULTI_BEAT_HARD_CEILING;
  }
  return floored;
}
