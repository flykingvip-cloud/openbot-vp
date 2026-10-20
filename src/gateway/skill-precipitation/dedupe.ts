/**
 * Dedupe precipitation drafts by whenToUse + tool-chain signature.
 */

import { createHash } from "node:crypto";
import {
  getSkillRuntimeDefinitionForBinding,
  listPersonalSkillAssets,
} from "../skill-lifecycle-store.js";
import type { SkillPrecipitationCandidate } from "./types.js";

function normalizeWhen(whenToUse: string): string {
  return whenToUse
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 160);
}

export function precipitationSignature(
  candidate: Pick<SkillPrecipitationCandidate, "whenToUse" | "toolChain">,
): string {
  const when = normalizeWhen(candidate.whenToUse);
  const tools = candidate.toolChain.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const raw = `${when}|${tools.join(">")}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function readStoredSignature(skillId: string): string | null {
  try {
    const binding = getSkillRuntimeDefinitionForBinding(skillId);
    const hints = binding.runtimeDefinition.routingHints as
      | { precipitation?: { toolChainSignature?: string; whenToUse?: string } }
      | null
      | undefined;
    const precip = hints && typeof hints === "object" ? hints.precipitation : null;
    if (precip?.whenToUse) {
      return precipitationSignature({
        whenToUse: precip.whenToUse,
        toolChain: precip.toolChainSignature
          ? precip.toolChainSignature.split(">").filter(Boolean)
          : [],
      });
    }
    // Fallback: compare profile summary as whenToUse with empty tools.
    return precipitationSignature({
      whenToUse: binding.profile.summary,
      toolChain: binding.runtimeDefinition.tools ?? [],
    });
  } catch {
    return null;
  }
}

/**
 * Find an existing draft/private skill with the same precipitation signature.
 * Returns skillId when a match exists (caller should reuse, not create a third asset).
 */
export function findExistingPrecipitationSkill(params: {
  signature: string;
  sourceAgentId?: string | null;
  ownerUserId?: string | null;
}): string | null {
  const owner = params.ownerUserId?.trim() || null;
  const agent = params.sourceAgentId?.trim() || null;
  const assets = listPersonalSkillAssets(owner ? { ownerUserId: owner } : undefined);
  for (const asset of assets) {
    if (asset.lifecycle !== "draft" && asset.lifecycle !== "private") {
      continue;
    }
    if (agent && asset.sourceRobot?.id && asset.sourceRobot.id !== agent) {
      continue;
    }
    if (!asset.profile.tags.includes("precipitation")) {
      // Still allow match via routingHints signature for older drafts.
    }
    const existing = readStoredSignature(asset.id);
    if (existing && existing === params.signature) {
      return asset.id;
    }
  }
  return null;
}
