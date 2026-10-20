/**
 * Conversation extraction (Phase C, scenario 2) — the extraction-specific gated
 * producer. From a group conversation it proposes dated ScheduleEntryCandidates the
 * user later confirms (the LLM never writes the authoritative schedule directly).
 * Mirrors `meeting-minutes-run.ts`:
 * - C1 `runGatedCandidateRun`: commercial gate + per-user usage + slot release.
 * - C0 `validateScheduleEntryCandidate`: each untrusted item is validated; invalid
 *   items are dropped (best-effort extraction feeds a confirm flow).
 *
 * The model runner stays injected (a dormant DI seam; see `lifecycle-model-runner.ts`).
 */

import {
  type CandidateValidation,
  type ScheduleEntryCandidate,
  validateScheduleEntryCandidate,
} from "../../organization/lifecycle-candidates.js";
import {
  type GatedCandidateRunDeps,
  type GatedCandidateRunResult,
  runGatedCandidateRun,
} from "./gated-candidate-run.js";

export type ScheduleExtractionRunInput = {
  runId: string;
  /** The user the extracted candidates (and usage) belong to. */
  userId: string;
  enterpriseId?: string;
  /** The conversation / notes text to extract dated action items from. */
  conversationText: string;
  /** Optional label for the source (e.g. space title) included in the prompt. */
  sourceLabel?: string;
};

export type ScheduleExtractionRunResult = GatedCandidateRunResult<ScheduleEntryCandidate[]>;

/** Deterministic prompt instructing the model to emit a JSON array of schedule candidates. */
export function buildScheduleExtractionPrompt(input: {
  conversationText: string;
  sourceLabel?: string;
}): string {
  return [
    "You extract concrete, dated action items from a conversation as schedule entries.",
    `Source: ${input.sourceLabel?.trim() || "(conversation)"}`,
    "Conversation:",
    input.conversationText,
    "",
    "Return ONLY a JSON array (no prose, no code fences). Each element:",
    '{"title": string, "startAt": string (ISO 8601), "endAt"?: string (ISO 8601), "timezone"?: string}',
    "Only include items with a clear time. If there are none, return [].",
  ].join("\n");
}

/**
 * Parses the model output into a list of validated ScheduleEntryCandidates. Non-array
 * output is rejected; individual invalid items are dropped (best-effort — the user
 * confirms each candidate before it is written, so a partial list is still useful).
 */
function parseScheduleCandidates(raw: string): CandidateValidation<ScheduleEntryCandidate[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["model output was not valid JSON"] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, errors: ["model output must be a JSON array"] };
  }
  const candidates: ScheduleEntryCandidate[] = [];
  for (const item of parsed) {
    const validated = validateScheduleEntryCandidate(item);
    if (validated.ok) {
      candidates.push(validated.value);
    }
  }
  return { ok: true, value: candidates };
}

/**
 * Runs a gated extraction turn: gate -> model -> validate candidate list -> per-user
 * usage. Returns the gated-run result; `produced` carries the validated candidates
 * (possibly empty) for the user to confirm via `schedule.entry.upsert`.
 */
export async function extractScheduleCandidates(
  input: ScheduleExtractionRunInput,
  deps: GatedCandidateRunDeps,
): Promise<ScheduleExtractionRunResult> {
  return runGatedCandidateRun<ScheduleEntryCandidate[]>(
    {
      runId: input.runId,
      userId: input.userId,
      ...(input.enterpriseId !== undefined ? { enterpriseId: input.enterpriseId } : {}),
      usageKey: "ai_token",
      prompt: buildScheduleExtractionPrompt(input),
      parse: parseScheduleCandidates,
    },
    deps,
  );
}
