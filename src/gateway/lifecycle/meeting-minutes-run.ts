/**
 * Meeting minutes generation (Phase C3) — the minutes-specific gated producer.
 *
 * Connects the Phase C boundary pieces for the `in_progress -> minuted` step:
 * - C1 `runGatedCandidateRun`: commercial gate + per-user usage + slot release.
 * - C0 `validateMinutesDraft`: the model's untrusted text is parsed into a typed
 *   MinutesDraft (or rejected) before anyone may persist it.
 *
 * The model runner stays injected (a dormant DI seam, mirroring the steward
 * M4b `generateSuggestionText` precedent): there is no lightweight one-shot LLM
 * helper in the codebase, so the real `runModel` (the heavy embedded-agent path)
 * is wired by the caller when connected. This module is pure orchestration +
 * prompt building, fully unit-testable with an injected runner.
 */

import {
  type CandidateValidation,
  type MinutesDraft,
  validateMinutesDraft,
} from "../../organization/lifecycle-candidates.js";
import {
  type GatedCandidateRunDeps,
  type GatedCandidateRunResult,
  runGatedCandidateRun,
} from "./gated-candidate-run.js";

export type MeetingMinutesRunInput = {
  runId: string;
  /** The organizer — usage is attributed to this user (per-user cost attribution). */
  organizerUserId: string;
  enterpriseId?: string;
  meetingTitle: string;
  /** The meeting transcript / notes the minutes are derived from. */
  transcript: string;
  attendeeUserIds?: string[];
};

export type MeetingMinutesRunResult = GatedCandidateRunResult<MinutesDraft>;

/**
 * Builds the deterministic prompt instructing the model to emit a MinutesDraft as
 * strict JSON. Kept pure/deterministic so the exact instruction is unit-testable
 * and the model contract is explicit (the output is still re-validated by C0).
 */
export function buildMeetingMinutesPrompt(input: {
  meetingTitle: string;
  transcript: string;
  attendeeUserIds?: string[];
}): string {
  const attendees =
    input.attendeeUserIds && input.attendeeUserIds.length > 0
      ? input.attendeeUserIds.join(", ")
      : "(unspecified)";
  return [
    "You are summarizing a meeting into structured minutes.",
    `Meeting title: ${input.meetingTitle}`,
    `Attendees: ${attendees}`,
    "Transcript:",
    input.transcript,
    "",
    "Return ONLY a JSON object with this exact shape (no prose, no code fences):",
    '{"summary": string, "decisions": string[], "actionItems": [{"title": string, "assigneeUserId"?: string, "dueAt"?: string (ISO 8601)}]}',
    "Each action item must have a concrete title; attribute it to an attendee when the transcript makes the owner clear.",
  ].join("\n");
}

function parseMinutesDraft(raw: string): CandidateValidation<MinutesDraft> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["model output was not valid JSON"] };
  }
  return validateMinutesDraft(parsed);
}

/**
 * Runs a gated minutes-generation turn: gate -> model -> validate MinutesDraft ->
 * per-user usage. Returns the gated-run result (produced/invalid/skipped/denied/
 * failed); persistence + the `in_progress -> minuted` transition are the caller's
 * job so this stays a pure producer.
 */
export async function generateMeetingMinutes(
  input: MeetingMinutesRunInput,
  deps: GatedCandidateRunDeps,
): Promise<MeetingMinutesRunResult> {
  return runGatedCandidateRun<MinutesDraft>(
    {
      runId: input.runId,
      userId: input.organizerUserId,
      ...(input.enterpriseId !== undefined ? { enterpriseId: input.enterpriseId } : {}),
      usageKey: "ai_token",
      prompt: buildMeetingMinutesPrompt(input),
      parse: parseMinutesDraft,
    },
    deps,
  );
}
