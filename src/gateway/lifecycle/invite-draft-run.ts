/**
 * Invite draft generation (Phase C, scenario 3 front-half) — the invite-specific
 * gated producer. Mirrors `meeting-minutes-run.ts`:
 * - C1 `runGatedCandidateRun`: commercial gate + per-user usage + slot release.
 * - C0 `validateInviteDraft`: the model's untrusted text is parsed into a typed
 *   InviteDraft (or rejected) before anyone may act on it.
 *
 * The model runner stays injected (a dormant DI seam; see `lifecycle-model-runner.ts`).
 * Pure orchestration + prompt building, fully unit-testable with an injected runner.
 */

import {
  type CandidateValidation,
  type InviteDraft,
  validateInviteDraft,
} from "../../organization/lifecycle-candidates.js";
import {
  type GatedCandidateRunDeps,
  type GatedCandidateRunResult,
  runGatedCandidateRun,
} from "./gated-candidate-run.js";

export type InviteDraftRunInput = {
  runId: string;
  /** The organizer — usage is attributed to this user (per-user cost attribution). */
  organizerUserId: string;
  enterpriseId?: string;
  meetingTitle: string;
  /** Free-text context describing what the meeting is about (the organizer's ask). */
  context: string;
  attendeeUserIds?: string[];
};

export type InviteDraftRunResult = GatedCandidateRunResult<InviteDraft>;

/** Deterministic prompt instructing the model to emit an InviteDraft as strict JSON. */
export function buildInviteDraftPrompt(input: {
  meetingTitle: string;
  context: string;
  attendeeUserIds?: string[];
}): string {
  const attendees =
    input.attendeeUserIds && input.attendeeUserIds.length > 0
      ? input.attendeeUserIds.join(", ")
      : "(unspecified)";
  return [
    "You are drafting a meeting invitation for the organizer to review before sending.",
    `Meeting title: ${input.meetingTitle}`,
    `Attendees: ${attendees}`,
    `Context: ${input.context}`,
    "",
    "Return ONLY a JSON object with this exact shape (no prose, no code fences):",
    '{"subject": string, "body": string, "proposedStartAt"?: string (ISO 8601), "proposedEndAt"?: string (ISO 8601), "attendeeUserIds": string[]}',
    "Keep the body concise and professional; only include attendees you were given.",
  ].join("\n");
}

function parseInviteDraft(raw: string): CandidateValidation<InviteDraft> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["model output was not valid JSON"] };
  }
  return validateInviteDraft(parsed);
}

/**
 * Runs a gated invite-draft turn: gate -> model -> validate InviteDraft -> per-user
 * usage. Returns the gated-run result (produced/invalid/skipped/denied/failed). The
 * organizer reviews/sends the draft separately (the LLM never sends invites itself).
 */
export async function generateInviteDraft(
  input: InviteDraftRunInput,
  deps: GatedCandidateRunDeps,
): Promise<InviteDraftRunResult> {
  return runGatedCandidateRun<InviteDraft>(
    {
      runId: input.runId,
      userId: input.organizerUserId,
      ...(input.enterpriseId !== undefined ? { enterpriseId: input.enterpriseId } : {}),
      usageKey: "ai_token",
      prompt: buildInviteDraftPrompt(input),
      parse: parseInviteDraft,
    },
    deps,
  );
}
