import type { PatternDetectionHint, PatternSignal } from "../pattern-detection.ts";
import { deriveIncubationDecision, type SessionQualityInput } from "./scorer.ts";
import type { AssetIncubationDecision } from "./types.ts";

function signalKinds(hint: PatternDetectionHint | null | undefined): Set<PatternSignal["kind"]> {
  return new Set((hint?.signals ?? []).map((signal) => signal.kind));
}

export function sessionInputFromPatternHint(
  hint: PatternDetectionHint | null | undefined,
  hasArtifact: boolean,
): SessionQualityInput {
  const kinds = signalKinds(hint);
  return {
    hasStructuredOutput: kinds.has("stable_io") || kinds.has("repeated_task"),
    hasArtifact,
    hasWorkflowLanguage: kinds.has("fixed_workflow"),
    hasTemplateOrReportLanguage: kinds.has("stable_prompt"),
  };
}

export function deriveIncubationFromPatternHint(params: {
  hint: PatternDetectionHint | null | undefined;
  hasArtifact: boolean;
  recurrenceCount?: number;
  contextId?: string | null;
}): AssetIncubationDecision {
  const sessionInput = sessionInputFromPatternHint(params.hint, params.hasArtifact);
  return deriveIncubationDecision({
    sessionInput,
    evidence: {
      recurrenceCount: params.recurrenceCount ?? 0,
    },
    contextId: params.contextId ?? params.hint?.contextId ?? null,
    source: "session-detector",
  });
}
