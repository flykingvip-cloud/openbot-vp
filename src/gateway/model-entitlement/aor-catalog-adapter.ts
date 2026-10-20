/**
 * ResourceModelCatalogEntry → AOR ModelProfile adapter.
 *
 * Production AOR must not use SEED_MODEL_CATALOG prices when a platform entry exists.
 */

import type { ModelProfile, ModelRef as AorModelRef } from "@openbot/aor-core";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";

function parseModelRef(modelId: string): AorModelRef | null {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null;
  }
  return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

/**
 * Convert cents-per-1M-tokens to aor-core's cost unit (currency per million tokens).
 * aor-core cost fields are relative ranking numbers; we use USD-equivalent dollars:
 * cents/1M → dollars/1M = cents/100.
 */
export function resourceCatalogEntryToAorProfile(
  entry: ResourceModelCatalogEntry,
): ModelProfile | null {
  if (!entry.enabled) {
    return null;
  }
  const ref = parseModelRef(entry.modelId);
  if (!ref) {
    return null;
  }
  const inputPerMtok = Math.max(0, entry.inputCostPer1MCents) / 100;
  const outputPerMtok = Math.max(0, entry.outputCostPer1MCents) / 100;
  const hasCost = entry.inputCostPer1MCents > 0 || entry.outputCostPer1MCents > 0;
  const taskTypeScores: Record<string, number> = {};
  for (const cap of entry.capabilities ?? []) {
    if (cap === "coding") {
      taskTypeScores.coding = 0.8;
    }
    if (cap === "reasoning") {
      taskTypeScores.reasoning = 0.85;
    }
    if (cap === "tool_use") {
      taskTypeScores.tool_use = 0.75;
    }
  }
  return {
    ref,
    cost: {
      inputPerMtok: hasCost ? inputPerMtok : Number.NaN,
      outputPerMtok: hasCost ? outputPerMtok : Number.NaN,
    },
    taskTypeScores,
    ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
  };
}

export function resourceCatalogToAorProfiles(entries: readonly ResourceModelCatalogEntry[]): {
  profiles: ModelProfile[];
  missingCostModelIds: string[];
} {
  const profiles: ModelProfile[] = [];
  const missingCostModelIds: string[] = [];
  for (const entry of entries) {
    const profile = resourceCatalogEntryToAorProfile(entry);
    if (!profile) {
      continue;
    }
    if (
      !Number.isFinite(profile.cost.inputPerMtok) ||
      !Number.isFinite(profile.cost.outputPerMtok)
    ) {
      missingCostModelIds.push(entry.modelId);
      // Explicit degrade: neutral rank cost so set conservation holds without demo seed prices.
      profile.cost = { inputPerMtok: 1, outputPerMtok: 1 };
    }
    profiles.push(profile);
  }
  return { profiles, missingCostModelIds };
}
