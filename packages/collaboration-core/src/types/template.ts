export type MemberRoleTemplate = {
  memberType: "human" | "bot" | "system_delegate";
  governanceRole?: "owner" | "admin" | "member";
  collaborationRole?:
    | "coordinator"
    | "final_decider"
    | "decision_advisor"
    | "contributor"
    | "reviewer"
    | "observer";
  visibility?: "visible" | "hidden";
  description?: string;
};

export type GroupTemplate = {
  templateId: string;
  name: string;
  description?: string;
  sourceGroupId: string;
  groupType: string;
  collaborationMode?: string;
  finalDecisionPolicy?: {
    mode: "human_required" | "delegated_low_risk";
    defaultFinalDeciderRole: "owner" | "admin";
    allowAgentPublishProposal: boolean;
  };
  memberRoles: MemberRoleTemplate[];
  createdAt: number;
  createdBy?: string;
};
