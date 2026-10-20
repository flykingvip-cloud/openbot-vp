/**
 * Detect whether a task trajectory should precipitate a skill draft.
 */

import { stripEphemeralFromText, collectEphemeralTokens } from "./ephemeral.js";
import type {
  PrecipitationDetectResult,
  SkillPrecipitationCandidate,
  SkillPrecipitationStep,
  TaskTrajectorySummary,
} from "./types.js";

const MIN_PERSIST_CONFIDENCE = 0.4;
const MIN_FULL_STEPS = 3;

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSteps(raw: TaskTrajectorySummary["steps"]): SkillPrecipitationStep[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SkillPrecipitationStep[] = [];
  let order = 1;
  for (const entry of raw) {
    if (typeof entry === "string") {
      const instruction = stripEphemeralFromText(entry.trim());
      if (instruction) {
        out.push({ order, instruction });
        order += 1;
      }
      continue;
    }
    if (entry && typeof entry === "object" && typeof entry.instruction === "string") {
      const instruction = stripEphemeralFromText(entry.instruction.trim());
      if (!instruction) {
        continue;
      }
      const tools = asStringList(entry.tools);
      out.push({
        order,
        instruction,
        ...(tools.length > 0 ? { tools } : {}),
      });
      order += 1;
    }
  }
  return out;
}

function uniquePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function scoreConfidence(input: {
  steps: SkillPrecipitationStep[];
  redLines: string[];
  acceptance: string[];
  evidence: string[];
  succeeded: boolean | null | undefined;
  userCorrections: string[];
}): number {
  let score = 0.2;
  if (input.steps.length >= 1) {
    score += 0.15;
  }
  if (input.steps.length >= MIN_FULL_STEPS) {
    score += 0.2;
  }
  if (input.redLines.length > 0) {
    score += 0.15;
  }
  if (input.acceptance.length > 0) {
    score += 0.1;
  }
  if (input.evidence.length > 0) {
    score += 0.15;
  }
  if (input.succeeded === true) {
    score += 0.1;
  }
  if (input.userCorrections.length > 0) {
    score += 0.05;
  }
  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Build a precipitation candidate from a trajectory summary.
 * Returns skip when evidence/whenToUse are missing or confidence is too low.
 */
export function detectPrecipitationCandidate(
  trajectory: TaskTrajectorySummary,
): PrecipitationDetectResult {
  const evidence = uniquePreserveOrder(asStringList(trajectory.sourceEvidenceRefs));
  const redLines = uniquePreserveOrder(
    asStringList(trajectory.redLines).map((line) => stripEphemeralFromText(line)),
  ).filter(Boolean);
  const acceptance = uniquePreserveOrder(
    asStringList(trajectory.acceptance).map((line) => stripEphemeralFromText(line)),
  ).filter(Boolean);
  const failureModes = uniquePreserveOrder(
    asStringList(trajectory.failureModes).map((line) => stripEphemeralFromText(line)),
  ).filter(Boolean);
  const userCorrections = uniquePreserveOrder(
    asStringList(trajectory.userCorrections).map((line) => stripEphemeralFromText(line)),
  ).filter(Boolean);

  let steps = normalizeSteps(trajectory.steps);
  // If no structured steps, try to split detail into ordered lines (still decontextualized).
  if (steps.length === 0 && trajectory.detail?.trim()) {
    const lines = trajectory.detail
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
      .filter((line) => line.length >= 8);
    steps = normalizeSteps(lines);
  }

  const toolChain = uniquePreserveOrder([
    ...asStringList(trajectory.toolsUsed),
    ...steps.flatMap((step) => step.tools ?? []),
  ]);

  const whenRaw =
    (trajectory.whenToUse ?? "").trim() ||
    (trajectory.nameHint ?? "").trim() ||
    (trajectory.detail ?? "").trim().slice(0, 200);
  const whenToUse = stripEphemeralFromText(whenRaw).slice(0, 500);

  if (!whenToUse) {
    return { kind: "skip", reason: "missing_when_to_use", confidence: 0 };
  }
  if (evidence.length === 0) {
    return { kind: "skip", reason: "missing_source_evidence_refs", confidence: 0 };
  }

  const ephemeralParams = uniquePreserveOrder([
    ...asStringList(trajectory.knownEphemeralParams),
    ...collectEphemeralTokens(
      [
        trajectory.whenToUse,
        trajectory.detail,
        ...(trajectory.steps ?? []).map((s) => (typeof s === "string" ? s : s.instruction)),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ]);

  const confidence = scoreConfidence({
    steps,
    redLines,
    acceptance,
    evidence,
    succeeded: trajectory.succeeded,
    userCorrections,
  });

  if (confidence < MIN_PERSIST_CONFIDENCE) {
    return {
      kind: "skip",
      reason: "confidence_below_threshold",
      confidence,
    };
  }

  const hasOrderDependency = steps.length >= 2;
  const hasStableConstraints = redLines.length > 0 || acceptance.length > 0;
  const rich =
    hasOrderDependency &&
    steps.length >= MIN_FULL_STEPS &&
    hasStableConstraints &&
    trajectory.succeeded === true;

  let completeness: SkillPrecipitationCandidate["completeness"] = "partial";
  let completenessReason: string | undefined;
  if (rich) {
    completeness = "full";
  } else if (steps.length === 0) {
    completeness = "partial";
    completenessReason = "insufficient_steps_for_recipe";
  } else if (!hasStableConstraints) {
    completeness = "partial";
    completenessReason = "missing_red_lines_or_acceptance";
  } else if (trajectory.succeeded !== true) {
    completeness = "partial";
    completenessReason = "run_not_marked_succeeded";
  } else {
    completeness = "partial";
    completenessReason = "below_full_recipe_signals";
  }

  const suggestedName = stripEphemeralFromText((trajectory.nameHint ?? whenToUse).trim()).slice(
    0,
    120,
  );

  const candidate: SkillPrecipitationCandidate = {
    whenToUse,
    redLines,
    steps,
    acceptance,
    failureModes: uniquePreserveOrder([
      ...failureModes,
      ...userCorrections.map((c) => `correction: ${c}`),
    ]),
    ephemeralParams,
    confidence,
    sourceEvidenceRefs: evidence,
    toolChain,
    completeness,
    ...(completenessReason ? { completenessReason } : {}),
    ...(suggestedName ? { suggestedName } : {}),
  };

  return { kind: "candidate", candidate };
}

export const PRECIPITATION_MIN_PERSIST_CONFIDENCE = MIN_PERSIST_CONFIDENCE;
