import { getKnowledgeBase, type KnowledgeBaseVisibility } from "./knowledge-base-store.js";
import type { SourceDescriptor } from "./sources/source-descriptor.js";

export type SourceBindingVisibilityBackfillResult = {
  scanned: number;
  updated: number;
  unchanged: number;
  missingKnowledgeBase: number;
};

function targetVisibilityForBinding(
  binding: SourceDescriptor,
  kbStorePath?: string,
): KnowledgeBaseVisibility | null {
  if (!binding.knowledgeBaseId) {
    return null;
  }
  const kb = getKnowledgeBase(binding.knowledgeBaseId, kbStorePath);
  return kb?.visibility ?? null;
}

/**
 * Idempotent lazy migration: bindings attached to a KB inherit that KB's visibility.
 * Safe to run on every read — only writes when a stored value is stale or missing.
 */
export function backfillSourceBindingVisibilities(params: {
  bindings: Record<string, SourceDescriptor>;
  kbStorePath?: string;
}): { bindings: Record<string, SourceDescriptor>; result: SourceBindingVisibilityBackfillResult } {
  const nextBindings = { ...params.bindings };
  let updated = 0;
  let unchanged = 0;
  let missingKnowledgeBase = 0;
  const entries = Object.values(params.bindings);

  for (const binding of entries) {
    const target = targetVisibilityForBinding(binding, params.kbStorePath);
    if (!binding.knowledgeBaseId) {
      unchanged += 1;
      continue;
    }
    if (!target) {
      missingKnowledgeBase += 1;
      continue;
    }
    if (binding.visibility === target) {
      unchanged += 1;
      continue;
    }
    nextBindings[binding.id] = { ...binding, visibility: target };
    updated += 1;
  }

  return {
    bindings: nextBindings,
    result: {
      scanned: entries.length,
      updated,
      unchanged,
      missingKnowledgeBase,
    },
  };
}
