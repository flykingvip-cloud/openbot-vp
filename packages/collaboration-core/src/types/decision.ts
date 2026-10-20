export type DecisionStatus = "draft" | "finalized" | "superseded";

export type DecisionOption = {
  optionId: string;
  title: string;
  description?: string;
  pros?: string[];
  cons?: string[];
};

export type Decision = {
  decisionId: string;
  groupId: string;
  title: string;
  description?: string;
  context?: string;
  options: DecisionOption[];
  selectedOption?: string;
  rationale?: string;
  deciderMemberId?: string;
  relatedTaskId?: string;
  relatedDeliverableId?: string;
  status: DecisionStatus;
  createdAt: number;
  updatedAt: number;
  finalizedAt?: number;
};
