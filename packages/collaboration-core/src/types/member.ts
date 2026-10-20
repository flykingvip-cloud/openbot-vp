export type CollaborationMemberKind = "human" | "bot" | "system_delegate";
export type CollaborationGovernanceRole = "owner" | "admin" | "member" | "observer";
export type CollaborationRole =
  | "coordinator"
  | "final_decider"
  | "decision_advisor"
  | "contributor"
  | "reviewer"
  | "observer";
export type CollaborationMemberStatus = "active" | "invited" | "paused" | "removed" | "revoked";
export type CollaborationMemberVisibility = "visible" | "hidden";

export type CollaborationMember = {
  memberId: string;
  memberKind: CollaborationMemberKind;
  userId?: string;
  agentId?: string;
  /**
   * For bot members: the platform user id of the human who owns this bot.
   * Recorded at join/authorization time so the group roster is self-describing
   * (attribution + owner-audit visibility). Never set for human members.
   */
  ownerUserId?: string;
  name?: string;
  governanceRole: CollaborationGovernanceRole;
  collaborationRole?: CollaborationRole;
  status: CollaborationMemberStatus;
  visibility?: CollaborationMemberVisibility;
  invitedAtMs?: number;
  joinedAtMs?: number;
  pausedAtMs?: number;
  removedAtMs?: number;
  updatedAtMs: number;
};
