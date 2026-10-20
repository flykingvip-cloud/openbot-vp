export type ContextMode = "minimal" | "auto" | "focused" | "deep";

export type ContextSourceType = "conversation" | "group" | "knowledge" | "folder" | "file" | "api";

export type ContextSource =
  | { type: "conversation"; id: string }
  | { type: "group"; groupId: string }
  | { type: "knowledge"; knowledgeBaseId: string }
  | { type: "folder"; path: string; parentId?: string }
  | { type: "file"; fileId: string; parentId?: string }
  | { type: "api"; connectorId: string; parentId?: string };

export type ContextScopeLifetime = "turn" | "session" | "group" | "user";

export type ContextBudget = {
  maxTokens: number;
  maxSources: number;
  maxFiles: number;
  maxRetrievalDepth: number;
  maxToolCalls: number;
};

export type RetrievalStrategy = {
  semanticSearch: boolean;
  keywordSearch: boolean;
  metadataFilter: boolean;
  recursiveFolderScan: boolean;
  externalApi: boolean;
  allowKnowledgePrefetch: boolean;
};

export type ContextPolicyV1 = {
  defaultMode: "auto";
  allowMemberOverride: boolean;
  mandatoryGroupContext: boolean;
  allowExternalSources: boolean;
  maxContextTokens: number;
  maxFilesPerRound: number;
  allowedSourceTypes: ContextSourceType[];
};

export const DEFAULT_CONTEXT_POLICY: ContextPolicyV1 = {
  defaultMode: "auto",
  allowMemberOverride: true,
  mandatoryGroupContext: true,
  allowExternalSources: true,
  maxContextTokens: 24_000,
  maxFilesPerRound: 20,
  allowedSourceTypes: ["conversation", "group", "knowledge", "folder", "file", "api"],
};

export type ContextScopeRequest = {
  mode?: ContextMode;
  sources?: ContextSource[];
  lifetime?: ContextScopeLifetime;
};

export type ContextConfidentialityLevel = "public" | "internal" | "restricted";

export type ContextScopeDeniedReason =
  | "unauthorized"
  | "ambiguous_identity"
  | "confidentiality"
  | "authorize_failed"
  | "persist_failed";

export type ContextScopeDeniedSource = {
  type: ContextSourceType;
  id: string;
  parentId?: string;
  reason: ContextScopeDeniedReason;
};

export type ContextScopePlan = {
  mode: ContextMode;
  sources: ContextSource[];
  mandatorySources: ContextSource[];
  retrievalStrategy: RetrievalStrategy;
  budget: ContextBudget;
  lifetime: ContextScopeLifetime;
  confidentiality: { maxLevel: ContextConfidentialityLevel };
  fullContextDumpAllowed: false;
  reasons: string[];
  deniedSources?: ContextScopeDeniedSource[];
};

export type ResolveContextScopeInput = {
  inboundDepth?: "chat" | "retrieve" | "act";
  sessionKey: string;
  groupId?: string | null;
  /** Group Member Visibility ceiling. Direct 1:1 sessions omit this. */
  groupConfidentiality?: string | null;
  request?: ContextScopeRequest;
  contextPolicy?: ContextPolicyV1;
};
