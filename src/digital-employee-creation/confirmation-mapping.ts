/**
 * Confirmation-card mapping projection. Data only — no UI, no CoT, no guesses.
 */

import { PUBLISHED_BLUEPRINTS } from "./catalogs.js";
import type { BlueprintDraft, EmployeeDesignIntent, RoleResolution } from "./types.js";

export type DesignMappingItem = { label: string; text: string };

export type DesignMappingCard = {
  headline: "我理解的是…";
  requestItems: DesignMappingItem[];
  role: {
    display: string;
    resolutionKind: RoleResolution["kind"];
    blueprintId?: string;
    blueprintVersion?: string;
    evidence: string[];
  };
  capabilities: Array<{ need: string; status: "resolved" | "unresolved"; skillKey?: string }>;
  workMode: { taskPatterns: string[]; schedule?: string; delivery?: string };
  safetyBoundary: Array<{ id: string; effect: string; risk: string }>;
  gaps: { questions: string[]; missing: string[]; unresolved: string[] };
};

const FORBIDDEN_MAPPING_KEYS = ["chainOfThought", "guessNarrative", "modelExplanation"] as const;

export function projectDesignMapping(
  intent: EmployeeDesignIntent,
  draft: BlueprintDraft,
): DesignMappingCard {
  const requestItems: DesignMappingItem[] = [
    { label: "原文", text: intent.rawRequest },
    ...intent.responsibilities.map((text) => ({ label: "职责", text })),
    ...intent.desiredOutcomes.map((text) => ({ label: "交付", text })),
    ...intent.constraints.map((text) => ({ label: "约束", text })),
    ...intent.policyRequirements.map((text) => ({ label: "安全边界", text })),
  ];
  if (intent.schedule) {
    requestItems.push({ label: "节奏", text: intent.schedule });
  }
  if (intent.delivery) {
    requestItems.push({ label: "交付物", text: intent.delivery });
  }

  const published = draft.roleResolution.kind === "published" ? draft.roleResolution : undefined;
  const publishedBlueprint = published
    ? PUBLISHED_BLUEPRINTS.find((entry) => entry.blueprintId === published.blueprintId)
    : undefined;
  return {
    headline: "我理解的是…",
    requestItems,
    role: {
      display:
        publishedBlueprint?.displayName ??
        (draft.roleResolution.kind === "custom_draft" ? "自定义草稿" : draft.roleHypothesis.role),
      resolutionKind: draft.roleResolution.kind,
      ...(published
        ? { blueprintId: published.blueprintId, blueprintVersion: published.blueprintVersion }
        : {}),
      evidence: draft.roleHypothesis.evidence,
    },
    capabilities: draft.skillRecommendations.map((entry) => ({
      need: entry.need,
      status: entry.status,
      ...(entry.skillKey ? { skillKey: entry.skillKey } : {}),
    })),
    workMode: {
      taskPatterns: draft.taskPatterns.map((item) => item.label),
      ...(intent.schedule ? { schedule: intent.schedule } : {}),
      ...(intent.delivery ? { delivery: intent.delivery } : {}),
    },
    safetyBoundary: draft.policyRecommendations.map((entry) => ({
      id: entry.id,
      effect: entry.effect,
      risk: entry.risk,
    })),
    gaps: {
      questions: draft.unresolvedQuestions.map((item) => item.text),
      missing: draft.missingCriticalInputs,
      unresolved: draft.unresolvedCapabilities,
    },
  };
}

export function mappingHasForbiddenNarrative(card: DesignMappingCard): boolean {
  const record = card as unknown as Record<string, unknown>;
  if (FORBIDDEN_MAPPING_KEYS.some((key) => key in record)) {
    return true;
  }
  return /我猜|思维链|chain of thought|i guess you/i.test(JSON.stringify(card));
}
