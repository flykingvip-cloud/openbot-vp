/**
 * Method + confidence + evidence-span lint for claims.list-shaped rows.
 * There is no claims.write; this never persists.
 */

export const KNOWN_CLAIM_EXTRACTION_METHODS = ["heuristic", "model", "explicit"] as const;
export type ClaimExtractionMethod = (typeof KNOWN_CLAIM_EXTRACTION_METHODS)[number];

export type ClaimEvidenceInput = {
  extraction_method?: string | null;
  confidence?: number | null;
  evidence_span?: string | null;
  claim_text?: string | null;
  preview_text?: string | null;
};

export type ClaimEvidenceViolation =
  | "missing_method"
  | "unknown_method"
  | "missing_confidence"
  | "invalid_confidence"
  | "missing_span"
  | "span_not_in_preview";

export type ClaimEvidenceLintResult = {
  ok: boolean;
  method: string;
  violations: ClaimEvidenceViolation[];
};

const KNOWN_METHOD_SET = new Set<string>(KNOWN_CLAIM_EXTRACTION_METHODS);

export function lintClaimEvidence(input: ClaimEvidenceInput): ClaimEvidenceLintResult {
  const violations: ClaimEvidenceViolation[] = [];
  const method = (input.extraction_method ?? "heuristic").trim() || "heuristic";

  if (!input.extraction_method?.trim()) {
    // Schema default is heuristic; treat omitted as heuristic, not missing.
  }
  if (!KNOWN_METHOD_SET.has(method)) {
    violations.push("unknown_method");
  }

  if (input.confidence == null || Number.isNaN(input.confidence)) {
    violations.push("missing_confidence");
  } else if (input.confidence < 0 || input.confidence > 1) {
    violations.push("invalid_confidence");
  }

  const span = input.evidence_span?.trim() || input.claim_text?.trim() || "";
  if (!span) {
    violations.push("missing_span");
  } else if (input.preview_text != null && !input.preview_text.includes(span)) {
    violations.push("span_not_in_preview");
  }

  return { ok: violations.length === 0, method, violations };
}
