export type CollaborationGroupType =
  | "project_delivery"
  | "research_analysis"
  | "ops_response"
  | "product_development"
  | "management_decision"
  | "general_collaboration";

export type CollaborationGroupLifecycleStatus =
  | "draft"
  | "provisioning"
  | "active"
  | "stable"
  | "idle"
  | "archived"
  | "closed";

export type CollaborationMode = "task_driven" | "discussion_driven" | "review_driven";

export type FinalDecisionPolicy = {
  mode: "human_required" | "delegated_low_risk";
  defaultFinalDeciderRole: "owner" | "admin";
  allowAgentPublishProposal: boolean;
};

export type GroupProfile = {
  groupId: string;
  groupCode: string;
  displayName: string;
  avatar?: string;
  visibilityScope?: "group_only" | "tenant" | "organization";
  groupType?: CollaborationGroupType;
  lifecycleStatus?: CollaborationGroupLifecycleStatus;
  ownerUserId?: string;
  coordinatorBotId?: string;
  purpose?: string;
  currentMission?: string;
  successCriteria?: string[];
  exitCriteria?: string[];
  collaborationMode?: CollaborationMode;
  finalDecisionPolicy?: FinalDecisionPolicy;
  directoryBindingId?: string;
  workspacePath?: string;
  createdAtMs: number;
  updatedAtMs: number;
};
