/**
 * Digital Employee Creation — P1 domain contracts.
 *
 * Offline only: no LLM, no agents.create, no workspace/skill/account writes.
 * Spec: `.kiro/specs/digital-employee-creation/p1-p2-design-baseline.md`
 */

export const DEC_CONTRACT_VERSION = "dec-p1-2026-09-17";

export const DRAFT_FORBIDDEN_FIELDS = [
  "agentId",
  "digitalEmployeeId",
  "accountBindings",
  "grantedPermissions",
  "conversationTaskId",
  "cronId",
  "missionId",
  "ledgerEventId",
] as const;

export type DraftForbiddenField = (typeof DRAFT_FORBIDDEN_FIELDS)[number];

export type DraftSource = "ai" | "role_chip" | "enterprise_template";

export type CreationSessionStatus =
  | "DESIGNING"
  | "DRAFT"
  | "REVISING"
  | "READY_FOR_CONFIRMATION"
  | "CONFIRMED"
  | "INSTANTIATING"
  | "INSTANTIATED"
  | "PARTIAL"
  | "FAILED";

export const CREATION_SESSION_STATUSES: readonly CreationSessionStatus[] = [
  "DESIGNING",
  "DRAFT",
  "REVISING",
  "READY_FOR_CONFIRMATION",
  "CONFIRMED",
  "INSTANTIATING",
  "INSTANTIATED",
  "PARTIAL",
  "FAILED",
] as const;

export type EmployeeDesignIntent = {
  rawRequest: string;
  desiredOutcomes: string[];
  responsibilities: string[];
  constraints: string[];
  schedule?: string;
  delivery?: string;
  policyRequirements: string[];
};

export type RoleHypothesis = {
  family: string;
  role: string;
  confidence: number;
  evidence: string[];
};

export type RoleResolution =
  | {
      kind: "published";
      blueprintId: string;
      blueprintVersion: string;
      matchedBy: "exact" | "alias" | "family";
    }
  | { kind: "custom_draft"; reason: string };

export type SkillRecommendation = {
  need: string;
  skillKey?: string;
  status: "resolved" | "unresolved";
  unresolvedReason?: string;
};

export type MemorySchema = {
  entities: string[];
  memoryTypes: string[];
  priority?: string[];
};

export type TaskPatternDeclaration = { id: string; label: string };

export type ToolRecommendation = { id: string; mode: "recommended" };

export type PolicyRecommendation = {
  id: string;
  effect: "recommended" | "confirmation_required" | "disabled";
  risk: "low" | "high";
};

export type InteractionProfile = {
  proactiveLevel: string;
  responseStyle: string;
};

export type DesignQuestion = { id: string; text: string; changes: string[] };

export type RiskFlag = { id: string; summary: string };

export type BlueprintValidationStatus = "valid" | "valid_with_gaps" | "invalid";

export type BlueprintValidation = {
  status: BlueprintValidationStatus;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
};

export type BlueprintDraft = {
  draftId: string;
  revision: number;
  source: DraftSource;
  roleHypothesis: RoleHypothesis;
  roleResolution: RoleResolution;
  responsibilities: string[];
  objectives: string[];
  roleRecipeIds: string[];
  skillRecommendations: SkillRecommendation[];
  memorySchema: MemorySchema;
  taskPatterns: TaskPatternDeclaration[];
  toolRecommendations: ToolRecommendation[];
  policyRecommendations: PolicyRecommendation[];
  interactionProfile: InteractionProfile;
  unresolvedQuestions: DesignQuestion[];
  missingCriticalInputs: string[];
  unresolvedCapabilities: string[];
  riskFlags: RiskFlag[];
  validation: BlueprintValidation;
};

export type RoleRecipe = {
  recipeId: string;
  skillKeys: string[];
};

export type PublishedBlueprint = {
  blueprintId: string;
  blueprintVersion: string;
  displayName: string;
  family: string;
  role: string;
  aliases: string[];
  familySignals: string[];
  recipeIds: string[];
  memorySchema: MemorySchema;
  taskPatterns: TaskPatternDeclaration[];
  policyRecommendations: PolicyRecommendation[];
  interactionProfile: InteractionProfile;
  missingCriticalInputs?: string[];
  legacyTemplateId?: string;
};

export type CreationSession = {
  id: string;
  draftId: string;
  status: CreationSessionStatus;
  idempotencyKey: string;
  actorUserId: string;
  instantiatedAgentId?: string;
};

export type SkillInstallReport = {
  requested: string[];
  succeeded: string[];
  failed: Array<{ skillKey: string; reason: string }>;
};

export type CreationReceipt = {
  agentId: string;
  blueprintId?: string;
  blueprintVersion?: string;
  roleRecipeIds: string[];
  skillKeysRequested: string[];
  skillInstall: SkillInstallReport;
  policyRecommendations: string[];
  createdByUserId: string;
  confirmedAt: string;
  creationSessionId: string;
};

/** P4 compile target. No agentId, accounts, grants, tasks, or cron. */
export type AgentCreateRequest = {
  name: string;
  blueprintId?: string;
  blueprintVersion?: string;
  skillKeys: string[];
};

export type DesignCatalog = {
  blueprints: readonly PublishedBlueprint[];
  recipes: readonly RoleRecipe[];
  skillKeys: ReadonlySet<string>;
};

export type DesignerReadCatalog =
  | "role_registry"
  | "blueprint_registry"
  | "recipe_registry"
  | "skill_registry"
  | "policy_schema"
  | "product_capability_catalog"
  | "creation_request_text";

export type DesignerDeniedCatalog =
  | "crm_customer_data"
  | "enterprise_memory"
  | "private_documents"
  | "conversation_history"
  | "account_tokens"
  | "sensitive_datasets";
