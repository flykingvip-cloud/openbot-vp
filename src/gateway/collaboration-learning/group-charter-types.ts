import type { CollaborationMember, GroupProfile } from "@openbot/collaboration-core";
import type { GatewayCollaborationGroupOperatingState } from "./operating-state-types.js";

export type GroupLifecycleStatus = "ACTIVE" | "FROZEN" | "ARCHIVED";

export type GroupCharterParticipationPolicy = {
  whyHere: string;
  whenToSpeak: string[];
  lowQualityBehaviors: string[];
};

export type GroupCharterCoordinatorPolicy = {
  coordinatorBotId?: string | null;
  responsibilities: string[];
  mustNotMonopolizeSpeech: boolean;
};

export type GroupPromotionPolicy = {
  allowAutoPromote: boolean;
  requireLifecycleActive: boolean;
  blockSecretAutoPromote: boolean;
  dissentEncouraged: boolean;
  minGroupParticipationRate?: number;
};

export type GroupCharterDocument = {
  groupId: string;
  lifecycleStatus: GroupLifecycleStatus;
  displayName: string;
  purpose?: string | null;
  currentMission?: string | null;
  operatingPhases: Array<
    GatewayCollaborationGroupOperatingState["activeContext"]["currentOperatingPhase"]
  >;
  participationPolicy: GroupCharterParticipationPolicy;
  coordinatorPolicy: GroupCharterCoordinatorPolicy;
  promotionPolicy: GroupPromotionPolicy;
  collaborationPolicySnapshot: GatewayCollaborationGroupOperatingState["collaborationPolicy"];
  updatedAtMs: number;
  metadata?: {
    origin?: string;
    charterVersion?: number;
  };
};

export type BuildGroupCharterInput = {
  groupId: string;
  profile: GroupProfile | null;
  members: CollaborationMember[];
  operatingState: GatewayCollaborationGroupOperatingState;
  existing?: GroupCharterDocument | null;
};
