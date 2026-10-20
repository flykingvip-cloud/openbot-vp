import type {
  AgentLearningAsset,
  BotParticipationProfile,
  Decision,
  Deliverable,
  GroupCapabilityProfile,
  GroupMemoryCapsule,
  LearningProjection,
  ParticipationCapabilityOverlay,
  Review,
  Task,
} from "@openbot/collaboration-core";
import type { GroupProfile } from "@openbot/collaboration-core";
import type { CollaborationSpaceEffectivePolicyView } from "../collaboration-dispatch/policy-lane-presentation.js";
import type { GatewayCollaborationGroupOperatingState } from "./operating-state-types.js";

export type GatewayCollaborationLearningSnapshotParams = {
  groupId: string;
  botId?: string;
};

export type GatewayCollaborationLearningSnapshot = {
  groupId: string;
  botId?: string | null;
  groupCapabilities: GroupCapabilityProfile | null;
  groupOperatingState: GatewayCollaborationGroupOperatingState | null;
  participations: BotParticipationProfile[];
  participationOverlays: ParticipationCapabilityOverlay[];
  capsules: GroupMemoryCapsule[];
  projections: LearningProjection[];
  assets: AgentLearningAsset[];
  tasks: Task[];
  deliverables: Deliverable[];
  reviews: Review[];
  decisions: Decision[];
};

export type GatewayCollaborationHumanMemberSnapshot = {
  userId: string;
  name?: string;
  email?: string;
  handle?: string;
  status: string;
  governanceRole?: string;
};

export type GatewayCollaborationBotMemberSnapshot = {
  agentId: string;
  name?: string;
  /**
   * Platform user id of the human who owns this bot, when recorded on the
   * member. Used to surface "X 的机器人" attribution and to gate owner-audit
   * visibility (the owner may read its own bot's group transcript).
   */
  ownerUserId?: string;
  status: string;
  runtimeStatus?: "online" | "busy" | "offline" | "unknown";
  lastActiveAt?: string;
  currentTask?: string;
  openTaskCount?: number;
};

export type GatewayCollaborationMemberRosterSnapshot = {
  humans: GatewayCollaborationHumanMemberSnapshot[];
  bots: GatewayCollaborationBotMemberSnapshot[];
};

export type GatewayCollaborationSpaceSnapshot = {
  id: string;
  groupId: string;
  title: string;
  /**
   * Authoritative enterprise tenant for this collaboration space.
   * Resolved from ownership binding (and create/update params when present).
   * Required for tenant-qualified chat fan-out ACL; absent means unmanaged /
   * pre-tenant legacy space (emit path fail-closes for employee shells).
   */
  tenantId?: string | null;
  ownerUserId?: string | null;
  visibilityScope?: string | null;
  purpose?: string | null;
  currentMission?: string | null;
  coordinatorBotId?: string | null;
  collaborationMode?: string | null;
  successCriteria?: string[] | null;
  systemInstructions?: string[] | null;
  confidentialityTier?: string | null;
  finalDecisionPolicy?: GroupProfile["finalDecisionPolicy"] | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  workspacePath?: string | null;
  members: GatewayCollaborationMemberRosterSnapshot;
  invites: GatewayCollaborationMemberRosterSnapshot;
  /**
   * P1-A5 ⑤ (BP-20): server-compiled frozen EffectivePolicy + provenance, attached at the
   * collaboration.spaces.list / collaboration.space.get egress. UI renders it verbatim.
   */
  effectivePolicy?: CollaborationSpaceEffectivePolicyView;
};

export type GatewayCollaborationSpacesListResult = {
  spaces: GatewayCollaborationSpaceSnapshot[];
  /** Group ids with lifecycle archived — used by UI to hide stale session fallbacks. */
  archivedGroupIds?: string[];
};

export type GatewayCollaborationSpaceResetParams = {
  groupId: string;
  actor?: string;
  resolveAgentStorePath?: (agentId: string) => string;
};

export type GatewayCollaborationSpaceDissolveParams = {
  groupId: string;
  actor?: string;
};

export type GatewayCollaborationSpaceLeaveParams = {
  groupId: string;
  actor?: string;
};

export type GatewayCollaborationSpaceOwnershipTransferParams = {
  groupId: string;
  newOwnerUserId: string;
  newOwnerLabel?: string;
  actor?: string;
};

export type GatewayCollaborationSpaceMembersUpdateParams = {
  groupId: string;
  title?: string;
  avatar?: string;
  visibilityScope?: string;
  tenantId?: string;
  ownerPositionId?: string;
  ownerPositionLabel?: string;
  ownerUserLabel?: string;
  /** Platform employee user id for the acting user (may differ from WS actor email). */
  actorEmployeeUserId?: string;
  purpose?: string;
  currentMission?: string;
  coordinatorBotId?: string;
  collaborationMode?: string;
  workspacePath?: string;
  successCriteria?: string[];
  systemInstructions?: string[];
  confidentialityTier?: string;
  finalDecisionPolicy?: GroupProfile["finalDecisionPolicy"];
  members: GatewayWorkspaceMemberRoster;
  invites?: GatewayWorkspaceMemberRoster;
  resolveAgentStorePath?: (agentId: string) => string;
};

type GatewayWorkspaceHumanMember = {
  userId: string;
  name?: string;
  handle?: string;
};

type GatewayWorkspaceBotMember = {
  agentId: string;
  name?: string;
};

type GatewayWorkspaceMemberRoster = {
  humans?: GatewayWorkspaceHumanMember[];
  bots?: GatewayWorkspaceBotMember[];
};
