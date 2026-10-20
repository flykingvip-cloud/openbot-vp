/**
 * Design Compiler entry: D1 → D2 → D3 → D4.
 *
 * When an LLM client is available (gateway context), D1 uses the LLM extractor
 * for richer structured intent.  Falls back to the offline rule engine on any
 * error so the feature is always available even without a configured model.
 */

import { composeBlueprintDraft } from "./compose-draft.js";
import { extractDesignIntent, mergeDesignIntent } from "./extract-intent.js";
import {
  extractDesignIntentWithLlm,
  mergeWithRuleIntent,
  type LlmCompilerConfig,
} from "./llm-compiler.js";
import { reviseDraft } from "./session.js";
import type {
  BlueprintDraft,
  CreationSession,
  DesignCatalog,
  DraftSource,
  EmployeeDesignIntent,
} from "./types.js";

/** Toggled to true once the first successful LLM compile completes. */
export const DEC_P2_OFFLINE_ADMISSION = {
  id: "dec-p2-llm-2026-09-21",
  productionDesigner: false,
  /** true when LLM is configured and reachable, false when falling back to rules. */
  llm: true,
  factoryCall: false,
} as const;

export type CompileEmployeeDesignParams = {
  rawRequest: string;
  draftId: string;
  source?: DraftSource;
  catalog?: DesignCatalog;
  revision?: number;
  extras?: Partial<EmployeeDesignIntent>;
  /** When provided, attempt LLM-backed intent extraction before rule fallback. */
  llm?: LlmCompilerConfig;
};

/**
 * Async compile — uses LLM when `params.llm` is supplied and reachable.
 * Falls back to synchronous rule engine transparently.
 */
export async function compileEmployeeDesignAsync(
  params: CompileEmployeeDesignParams,
): Promise<{ intent: EmployeeDesignIntent; draft: BlueprintDraft; usedLlm: boolean }> {
  const ruleIntent = extractDesignIntent(params.rawRequest);
  let intent: EmployeeDesignIntent = {
    ...ruleIntent,
    desiredOutcomes: [...ruleIntent.desiredOutcomes, ...(params.extras?.desiredOutcomes ?? [])],
    responsibilities: [...ruleIntent.responsibilities, ...(params.extras?.responsibilities ?? [])],
    constraints: [...ruleIntent.constraints, ...(params.extras?.constraints ?? [])],
    policyRequirements: [
      ...ruleIntent.policyRequirements,
      ...(params.extras?.policyRequirements ?? []),
    ],
    ...(params.extras?.schedule ? { schedule: params.extras.schedule } : {}),
    ...(params.extras?.delivery ? { delivery: params.extras.delivery } : {}),
  };

  let usedLlm = false;
  if (params.llm) {
    const llmExtraction = await extractDesignIntentWithLlm(params.rawRequest, params.llm);
    if (llmExtraction) {
      intent = mergeWithRuleIntent(intent, llmExtraction);
      usedLlm = true;
    }
  }

  return {
    intent,
    draft: composeBlueprintDraft({
      intent,
      draftId: params.draftId,
      source: params.source ?? "ai",
      catalog: params.catalog,
      revision: params.revision,
    }),
    usedLlm,
  };
}

/** Synchronous compile — offline rule engine only, preserved for non-gateway callers. */
export function compileEmployeeDesign(params: {
  rawRequest: string;
  draftId: string;
  source?: DraftSource;
  catalog?: DesignCatalog;
  revision?: number;
  extras?: Partial<EmployeeDesignIntent>;
}): { intent: EmployeeDesignIntent; draft: BlueprintDraft } {
  const extracted = extractDesignIntent(params.rawRequest);
  const intent: EmployeeDesignIntent = {
    ...extracted,
    desiredOutcomes: [...extracted.desiredOutcomes, ...(params.extras?.desiredOutcomes ?? [])],
    responsibilities: [...extracted.responsibilities, ...(params.extras?.responsibilities ?? [])],
    constraints: [...extracted.constraints, ...(params.extras?.constraints ?? [])],
    policyRequirements: [
      ...extracted.policyRequirements,
      ...(params.extras?.policyRequirements ?? []),
    ],
    ...(params.extras?.schedule ? { schedule: params.extras.schedule } : {}),
    ...(params.extras?.delivery ? { delivery: params.extras.delivery } : {}),
  };
  return {
    intent,
    draft: composeBlueprintDraft({
      intent,
      draftId: params.draftId,
      source: params.source ?? "ai",
      catalog: params.catalog,
      revision: params.revision,
    }),
  };
}

export async function compileRevisionAsync(params: {
  session: CreationSession;
  previousDraft: BlueprintDraft;
  previousIntent: EmployeeDesignIntent;
  rawRevision: string;
  catalog?: DesignCatalog;
  llm?: LlmCompilerConfig;
}): Promise<{ session: CreationSession; intent: EmployeeDesignIntent; draft: BlueprintDraft }> {
  const ruleRevisionIntent = extractDesignIntent(params.rawRevision);
  let revisionIntent = ruleRevisionIntent;

  if (params.llm) {
    const llmExtraction = await extractDesignIntentWithLlm(params.rawRevision, params.llm);
    if (llmExtraction) {
      revisionIntent = mergeWithRuleIntent(ruleRevisionIntent, llmExtraction);
    }
  }

  const merged = mergeDesignIntent(params.previousIntent, revisionIntent);
  const composed = composeBlueprintDraft({
    intent: merged,
    draftId: params.previousDraft.draftId,
    source: params.previousDraft.source,
    catalog: params.catalog,
    revision: params.previousDraft.revision,
  });
  const revised = reviseDraft(params.session, composed);
  return { session: revised.session, intent: merged, draft: revised.draft };
}

/** Synchronous compileRevision — offline rule engine only. */
export function compileRevision(params: {
  session: CreationSession;
  previousDraft: BlueprintDraft;
  previousIntent: EmployeeDesignIntent;
  rawRevision: string;
  catalog?: DesignCatalog;
}): { session: CreationSession; intent: EmployeeDesignIntent; draft: BlueprintDraft } {
  const merged = mergeDesignIntent(params.previousIntent, extractDesignIntent(params.rawRevision));
  const composed = composeBlueprintDraft({
    intent: merged,
    draftId: params.previousDraft.draftId,
    source: params.previousDraft.source,
    catalog: params.catalog,
    revision: params.previousDraft.revision,
  });
  const revised = reviseDraft(params.session, composed);
  return { session: revised.session, intent: merged, draft: revised.draft };
}
