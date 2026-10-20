export type KnowledgeActionType =
  | "archive_deliverable"
  | "open_governance"
  | "merge_duplicate"
  | "review_conflict"
  | "establish_relation"
  | "update_knowledge"
  | "open_object";

export type KnowledgeActionContext = {
  knowledgeBaseId?: string;
  deliverableId?: string;
  governanceTaskId?: string;
  objectId?: string;
  targetObjectId?: string;
};

export type KnowledgeActionTrustLabel = "high" | "medium" | "low";

export type KnowledgeActionSuggestion = {
  actionId: string;
  actionType: KnowledgeActionType;
  title: string;
  reason: string;
  score: number;
  context: KnowledgeActionContext;
  executable: boolean;
  /** Human-readable evidence bullets for the AI insight panel (optional/back-compat). */
  evidence?: string[];
  /** Trust band for UI display; derived from score when omitted. */
  trustLabel?: KnowledgeActionTrustLabel;
};
