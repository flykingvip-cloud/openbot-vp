/**
 * Employee Collaboration Group read model — Phase 0 contract.
 *
 * Scope: system settings →「我的协作小组」only.
 * Group-rule "governance" here means collaboration-layer rules, not enterprise mesh.
 *
 * Spec: docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md §4 / §7.1
 */

export type CollaborationGroupBasicProjection = {
  groupId: string;
  sessionKey: string;
  title: string;
  avatar: string | null;
  positioning: string | null;
  lifecycleStatus: string | null;
  ownerUserId: string | null;
  ownerLabel: string | null;
  coordinatorBotId: string | null;
  coordinatorBotLabel: string | null;
};

export type CollaborationGroupMissionProjection = {
  purpose: string | null;
  currentMission: string | null;
  successCriteria: string[];
};

export type CollaborationGroupMemberProjection = {
  memberId: string;
  kind: "human" | "bot";
  name: string;
  /** Role / identity in the group */
  identity: string | null;
  /** Duty assignment, e.g. 市场分析 */
  duty: string | null;
  /**
   * 0–100 display score.
   * Phase 3 v1 = session share; Phase 4 follow-up v2 = composite contributionScore.
   */
  contribution: number | null;
  /** Raw session-share percent (v1); kept for transparency / debugging. */
  contributionSessionShare?: number | null;
  lastActiveAt: number | null;
};

/** Collaboration-layer group rules (not enterprise mesh governance). */
export type CollaborationGroupRulesProjection = {
  openDiscussion: boolean | null;
  maxVisibleBotRepliesPerRound: number | null;
  confidentialityTier: string | null;
  learningStrategy: string | null;
  sharingStrategy: string | null;
  collaborationMode: string | null;
  archived: boolean;
};

/** Which collaboration-group blocks are populated (Gateway Phase 0+). */
export type CollaborationGroupBlocksComplete = {
  basic: boolean;
  mission: boolean;
  members: boolean;
  rules: boolean;
};

export type CollaborationGroupProjection = {
  basic: CollaborationGroupBasicProjection;
  mission: CollaborationGroupMissionProjection;
  members: CollaborationGroupMemberProjection[];
  rules: CollaborationGroupRulesProjection;
  /**
   * Optional Gateway delivery metadata (aligned with collaboration.space.get).
   * `phase: 0` means basic/mission shell; members/rules enrich in Phase 3.
   */
  phase?: number;
  blocksComplete?: CollaborationGroupBlocksComplete;
};

export function createEmptyCollaborationGroupProjection(params: {
  groupId: string;
  sessionKey: string;
  title?: string;
}): CollaborationGroupProjection {
  return {
    basic: {
      groupId: params.groupId,
      sessionKey: params.sessionKey,
      title: params.title?.trim() || params.groupId,
      avatar: null,
      positioning: null,
      lifecycleStatus: null,
      ownerUserId: null,
      ownerLabel: null,
      coordinatorBotId: null,
      coordinatorBotLabel: null,
    },
    mission: {
      purpose: null,
      currentMission: null,
      successCriteria: [],
    },
    members: [],
    rules: {
      openDiscussion: null,
      maxVisibleBotRepliesPerRound: null,
      confidentialityTier: null,
      learningStrategy: null,
      sharingStrategy: null,
      collaborationMode: null,
      archived: false,
    },
    phase: 0,
    blocksComplete: {
      basic: false,
      mission: false,
      members: false,
      rules: false,
    },
  };
}

/** Phase 3 v1 contribution: session share → 0–100. */
export function computeContributionFromSessionShare(
  memberSessionCount: number,
  totalSessions: number,
): number | null {
  if (
    !Number.isFinite(memberSessionCount) ||
    !Number.isFinite(totalSessions) ||
    totalSessions <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((memberSessionCount / totalSessions) * 100)));
}

function roleWeightForContribution(params: {
  governanceRole: string | null | undefined;
  isCoordinator?: boolean;
}): number {
  switch (params.governanceRole) {
    case "owner":
      return 100;
    case "admin":
      return 80;
    default:
      return params.isCoordinator ? 70 : 40;
  }
}

function recencyScoreForContribution(lastActiveAt: number | null | undefined, now = Date.now()) {
  if (typeof lastActiveAt !== "number" || !Number.isFinite(lastActiveAt) || lastActiveAt <= 0) {
    return 0;
  }
  const ageDays = Math.max(0, (now - lastActiveAt) / (24 * 60 * 60 * 1000));
  if (ageDays <= 7) {
    return 100;
  }
  if (ageDays <= 30) {
    return 70;
  }
  if (ageDays <= 90) {
    return 40;
  }
  return 10;
}

/**
 * Phase 4 follow-up · contribution v2 (independent score).
 * score = 0.5 * sessionShare + 0.3 * recency + 0.2 * roleWeight
 */
export function computeContributionScoreV2(params: {
  sessionShare: number | null;
  lastActiveAt: number | null;
  governanceRole?: string | null;
  isCoordinator?: boolean;
  now?: number;
}): number | null {
  if (params.sessionShare == null && params.lastActiveAt == null && !params.governanceRole) {
    return null;
  }
  const sessionShare = params.sessionShare ?? 0;
  const recency = recencyScoreForContribution(params.lastActiveAt, params.now);
  const role = roleWeightForContribution({
    governanceRole: params.governanceRole,
    isCoordinator: params.isCoordinator,
  });
  return Math.max(0, Math.min(100, Math.round(0.5 * sessionShare + 0.3 * recency + 0.2 * role)));
}
