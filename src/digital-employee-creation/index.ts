/**
 * Digital Employee Creation — P1 + P2-OFFLINE public surface.
 *
 * Offline domain: types, catalogs, D1–D4, session machine, adapter compile.
 * Does not call models, agents.create, or install skills.
 */

export {
  DEC_CONTRACT_VERSION,
  CREATION_SESSION_STATUSES,
  DRAFT_FORBIDDEN_FIELDS,
} from "./types.js";
export type {
  AgentCreateRequest,
  BlueprintDraft,
  BlueprintValidation,
  CreationReceipt,
  CreationSession,
  CreationSessionStatus,
  DesignCatalog,
  EmployeeDesignIntent,
  PublishedBlueprint,
  RoleHypothesis,
  RoleRecipe,
  RoleResolution,
  SkillInstallReport,
  SkillRecommendation,
} from "./types.js";

export {
  DEFAULT_DESIGN_CATALOG,
  GROWTH_TEMPLATE_IDS,
  LEGACY_TEMPLATE_INTERPRETATION,
  PUBLISHED_BLUEPRINTS,
  ROLE_RECIPES,
  TENANT_CAPABILITY_PACK_IDS,
  isTenantCapabilityPackId,
} from "./catalogs.js";

export {
  detectCapabilityNeeds,
  hypothesizeRole,
  resolvePublishedRole,
  resolveSkillNeed,
} from "./resolve.js";
export { extractDesignIntent, mergeDesignIntent } from "./extract-intent.js";
export {
  DEC_P2_OFFLINE_ADMISSION,
  compileEmployeeDesign,
  compileEmployeeDesignAsync,
  compileRevision,
  compileRevisionAsync,
} from "./compile.js";
export type { CompileEmployeeDesignParams } from "./compile.js";
export {
  extractDesignIntentWithLlm,
  mergeWithRuleIntent,
  parseLlmDesignExtraction,
} from "./llm-compiler.js";
export type { LlmDesignExtraction, LlmCompilerConfig } from "./llm-compiler.js";
export { mappingHasForbiddenNarrative, projectDesignMapping } from "./confirmation-mapping.js";
export type { DesignMappingCard } from "./confirmation-mapping.js";
export { composeBlueprintDraft } from "./compose-draft.js";
export { canShowConfirmationCard, validateBlueprintDraft } from "./validate-draft.js";
export { COMPILER_FIXTURES } from "./fixtures.js";
export { replayAllCompilerFixtures, replayCompilerFixture } from "./replay.js";
export { digitalEmployeeHandlers, createDigitalEmployeeHandlers } from "./gateway-handlers.js";
export { designSessionStore, DesignSessionStore } from "./gateway-store.js";
export {
  InstantiationLedger,
  abortSession,
  acceptDraft,
  beginInstantiate,
  canCallFactory,
  canTransition,
  confirmDraft,
  finishInstantiate,
  markDraftReady,
  reviseDraft,
} from "./session.js";
export {
  FACTORY_ADAPTER_CONTRACT,
  adapterRequestHasForbiddenKeys,
  buildAgentCreateRequest,
  buildCreationReceipt,
} from "./factory-adapter.js";
export {
  DESIGNER_FORBIDDEN_WRITES,
  DESIGNER_READ_ALLOWLIST,
  DESIGNER_READ_DENYLIST,
  FACTORY_ONLY_WRITES,
  emptySideEffects,
  hasAnySideEffect,
  isDesignerReadAllowed,
  isDesignerWriteForbidden,
} from "./ownership.js";
