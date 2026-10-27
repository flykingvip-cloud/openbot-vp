import type { CollaborationMember, GroupProfile } from "@openbot/collaboration-core";
import type { BootstrapStatus, GrowthStatus } from "../agent-growth/types.js";

export type GatewayCollaborationOperatingPhase =
  | "explore"
  | "debate"
  | "decide"
  | "deliver"
  | "review";

export type GatewayCollaborationGroupOperatingState = {
  groupId: string;
  groupProfile: {
    displayName: string;
    visibilityScope?: string | null;
    groupType?: string | null;
    lifecycleStatus?: string | null;
    purpose?: string | null;
    currentMission?: string | null;
    discussionScope?: string | null;
    expectedOutputs: string[];
    collaborationMode?: string | null;
    successCriteria: string[];
  };
  governance: {
    ownerUserId?: string | null;
    adminUserIds: string[];
    coordinatorBotId?: string | null;
    finalDecisionPolicy?: GroupProfile["finalDecisionPolicy"] | null;
  };
  collaborationPolicy: {
    humanStartsNewRound: boolean;
    mentionBotMustRespond: boolean;
    mentionHumanNotifiesOnly: boolean;
    openDiscussionWithoutMention: boolean;
    /** Decoupled from openDiscussionWithoutMention — enables post-primary supplement. */
    allowSupplementAfterPrimary?: boolean;
    maxVisibleBotRepliesPerRound: number;
    /** Optional cap for group-broadcast rounds; defaults to all active bots. */
    maxVisibleBotRepliesPerRoundBroad?: number;
    botMaySelfAdvanceWithoutHuman: boolean;
    entersWaitingForHumanAfterVisibleTurnsExhausted: boolean;
    /** Persistent group language contract; inherit = detect per round. */
    replyLanguage?: "zh" | "en" | "inherit";
  };
  memberRoleMap: Array<{
    memberId: string;
    memberKind: CollaborationMember["memberKind"];
    label?: string | null;
    governanceRole: CollaborationMember["governanceRole"];
    collaborationRole?: CollaborationMember["collaborationRole"] | null;
    status: CollaborationMember["status"];
  }>;
  activeContext: {
    currentOperatingPhase: GatewayCollaborationOperatingPhase;
    currentMission?: string | null;
    currentTaskId?: string | null;
    currentReviewId?: string | null;
    currentDecisionId?: string | null;
    currentDeliverableId?: string | null;
    waitingForHuman: boolean;
    summary: string;
    updatedAtMs: number;
  };
  /**
   * @deprecated 技术初始化状态。一期保留为只读别名，新代码请读 `bootstrapStatus`。
   * 见 spec agent-growth-lifecycle R1 / design 附录 C。
   */
  onboardingStatus: {
    initialized: boolean;
    bootstrappedAtMs?: number | null;
    bootstrapMemoryId?: string | null;
    charterCapsuleId?: string | null;
  };
  /** 技术初始化状态（替代 onboardingStatus；Bootstrap ≠ Growth）。 */
  bootstrapStatus?: BootstrapStatus;
  /** 产品成长状态（生命周期 / 维度 / 评分 / 里程碑）。小组首次 persist 时初始化。 */
  growthStatus?: GrowthStatus;
  groupMemoryRefs: {
    bootstrapMemoryId?: string | null;
    charterCapsuleId?: string | null;
    latestCapsuleIds: string[];
  };
  updatedAtMs: number;
  /**
   * T51/T52: monotonic authorization version on the durable operating-state object.
   * Shared revoke/commit/take condition (see task-control-cas). Absent ⇒ 0.
   * Business writes must not roll this back (writeGroupOperatingState auth merge).
   */
  authEpoch?: number;
  /**
   * P1-A2 (Floor Runtime v2.1 §4.2): monotonic revision of the L2 policy literals.
   * Absent ⇒ 0. Bumped by policy migrations (PolicyMigrationEvent.policyRevision)
   * and used as the CAS token for migration txns.
   */
  policyRevision?: number;
};
