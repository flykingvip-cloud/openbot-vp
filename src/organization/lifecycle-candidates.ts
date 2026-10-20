/**
 * Lifecycle candidate domain (Phase C, C0) — the deterministic boundary between
 * LLM output and authoritative storage.
 *
 * The schedule/meeting design has one hard red line: an LLM MUST NEVER write the
 * authoritative store directly. Every LLM-produced item (a drafted invite, an
 * extracted action item, generated minutes) is first a *candidate*: untrusted
 * structured data that this module validates with pure, deterministic schemas and
 * then maps into an authoritative write input whose owner/id/status are stamped
 * SERVER-SIDE (never taken from the candidate).
 *
 * This module is intentionally framework-free: no IO, no gateway, no LLM, no
 * billing. It is pure input -> output so the safety invariants ("a validated
 * candidate can never carry an LLM-injected ownerUserId/id/status", "endAt before
 * startAt is always rejected") are unit- and property-testable.
 *
 * Candidate kinds (design 3.3):
 * - ScheduleEntryCandidate: scenario 1/2 (NL or conversation -> a dated entry)
 * - TaskCandidate:          minutes -> a per-person task (NOT yet a TaskAssignment)
 * - InviteDraft:            scenario 3 front-half (a drafted meeting invite)
 * - MinutesDraft:           scenario 3 back-half (generated meeting minutes)
 */

export type CandidateKind = "schedule_entry" | "task" | "invite_draft" | "minutes_draft";

/** A dated entry extracted from NL / conversation, pending user confirmation. */
export type ScheduleEntryCandidate = {
  kind: "schedule_entry";
  title: string;
  /** ISO 8601 timestamp (validated parseable). */
  startAt: string;
  endAt?: string;
  timezone?: string;
  /** The source snippet it was derived from (for the review UI; never authoritative). */
  sourceText?: string;
};

/**
 * A per-person task split out of minutes. Carries an optional `assigneeUserId`,
 * but is explicitly NOT written to `TaskAssignment` here — fan-out (with cross-person
 * authorization) is the separately-reviewed Phase C4 step.
 */
export type TaskCandidate = {
  kind: "task";
  title: string;
  assigneeUserId?: string;
  /** ISO 8601 due timestamp (validated parseable). */
  dueAt?: string;
  sourceText?: string;
};

/** A drafted meeting invite, pending the organizer's approval (the human gate). */
export type InviteDraft = {
  kind: "invite_draft";
  subject: string;
  body: string;
  proposedStartAt?: string;
  proposedEndAt?: string;
  attendeeUserIds: string[];
};

/** Generated meeting minutes, pending user confirmation before distribution. */
export type MinutesDraft = {
  kind: "minutes_draft";
  summary: string;
  decisions: string[];
  /** Each action item is itself a TaskCandidate (re-validated). */
  actionItems: TaskCandidate[];
};

export type LifecycleCandidate =
  | ScheduleEntryCandidate
  | TaskCandidate
  | InviteDraft
  | MinutesDraft;

/** Validation result: a clean typed value or a list of human-readable errors. */
export type CandidateValidation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// ─────────────────────────────────────────────────────────────────────────
// Pure field coercions (the only way untrusted values enter a candidate)
// ─────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Non-empty trimmed string, else null. */
function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parseable ISO timestamp -> its canonical ISO string + epoch ms, else null. */
function asTimestamp(value: unknown): { iso: string; ms: number } | null {
  if (typeof value !== "string") {
    return null;
  }
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  return { iso: new Date(ms).toISOString(), ms };
}

/** Array of non-empty trimmed strings (deduped, order preserved), else null when not an array. */
function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const str = asNonEmptyString(entry);
    if (str && !seen.has(str)) {
      seen.add(str);
      out.push(str);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Validators (unknown LLM output -> typed candidate or errors)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validates a ScheduleEntryCandidate. The returned value is constructed field by
 * field from the allowed keys ONLY, so any extra keys the LLM emitted (e.g.
 * `ownerUserId`, `id`, `status`) are dropped and can never reach the store.
 */
export function validateScheduleEntryCandidate(
  input: unknown,
): CandidateValidation<ScheduleEntryCandidate> {
  const record = asRecord(input);
  if (!record) {
    return { ok: false, errors: ["candidate must be an object"] };
  }
  const errors: string[] = [];

  const title = asNonEmptyString(record.title);
  if (!title) {
    errors.push("title is required");
  }
  const start = asTimestamp(record.startAt);
  if (!start) {
    errors.push("startAt must be a valid ISO timestamp");
  }
  let end: { iso: string; ms: number } | null = null;
  if (record.endAt !== undefined && record.endAt !== null) {
    end = asTimestamp(record.endAt);
    if (!end) {
      errors.push("endAt must be a valid ISO timestamp");
    }
  }
  if (start && end && end.ms < start.ms) {
    errors.push("endAt must not be before startAt");
  }
  const timezone = record.timezone === undefined ? null : asNonEmptyString(record.timezone);
  if (record.timezone !== undefined && record.timezone !== null && !timezone) {
    errors.push("timezone must be a non-empty string when present");
  }
  const sourceText = asNonEmptyString(record.sourceText);

  if (errors.length > 0 || !title || !start) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      kind: "schedule_entry",
      title,
      startAt: start.iso,
      ...(end ? { endAt: end.iso } : {}),
      ...(timezone ? { timezone } : {}),
      ...(sourceText ? { sourceText } : {}),
    },
  };
}

/** Validates a TaskCandidate (the per-person split unit; never auto-assigned here). */
export function validateTaskCandidate(input: unknown): CandidateValidation<TaskCandidate> {
  const record = asRecord(input);
  if (!record) {
    return { ok: false, errors: ["candidate must be an object"] };
  }
  const errors: string[] = [];

  const title = asNonEmptyString(record.title);
  if (!title) {
    errors.push("title is required");
  }
  const assigneeUserId =
    record.assigneeUserId === undefined ? null : asNonEmptyString(record.assigneeUserId);
  if (record.assigneeUserId !== undefined && record.assigneeUserId !== null && !assigneeUserId) {
    errors.push("assigneeUserId must be a non-empty string when present");
  }
  let due: { iso: string; ms: number } | null = null;
  if (record.dueAt !== undefined && record.dueAt !== null) {
    due = asTimestamp(record.dueAt);
    if (!due) {
      errors.push("dueAt must be a valid ISO timestamp");
    }
  }
  const sourceText = asNonEmptyString(record.sourceText);

  if (errors.length > 0 || !title) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      kind: "task",
      title,
      ...(assigneeUserId ? { assigneeUserId } : {}),
      ...(due ? { dueAt: due.iso } : {}),
      ...(sourceText ? { sourceText } : {}),
    },
  };
}

/** Validates an InviteDraft. Attendee ids are deduped; empties dropped. */
export function validateInviteDraft(input: unknown): CandidateValidation<InviteDraft> {
  const record = asRecord(input);
  if (!record) {
    return { ok: false, errors: ["candidate must be an object"] };
  }
  const errors: string[] = [];

  const subject = asNonEmptyString(record.subject);
  if (!subject) {
    errors.push("subject is required");
  }
  const body = asNonEmptyString(record.body);
  if (!body) {
    errors.push("body is required");
  }
  const attendeeUserIds = asStringList(record.attendeeUserIds) ?? [];
  let start: { iso: string; ms: number } | null = null;
  if (record.proposedStartAt !== undefined && record.proposedStartAt !== null) {
    start = asTimestamp(record.proposedStartAt);
    if (!start) {
      errors.push("proposedStartAt must be a valid ISO timestamp");
    }
  }
  let end: { iso: string; ms: number } | null = null;
  if (record.proposedEndAt !== undefined && record.proposedEndAt !== null) {
    end = asTimestamp(record.proposedEndAt);
    if (!end) {
      errors.push("proposedEndAt must be a valid ISO timestamp");
    }
  }
  if (start && end && end.ms < start.ms) {
    errors.push("proposedEndAt must not be before proposedStartAt");
  }

  if (errors.length > 0 || !subject || !body) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      kind: "invite_draft",
      subject,
      body,
      ...(start ? { proposedStartAt: start.iso } : {}),
      ...(end ? { proposedEndAt: end.iso } : {}),
      attendeeUserIds,
    },
  };
}

/** Validates a MinutesDraft, re-validating each action item as a TaskCandidate. */
export function validateMinutesDraft(input: unknown): CandidateValidation<MinutesDraft> {
  const record = asRecord(input);
  if (!record) {
    return { ok: false, errors: ["candidate must be an object"] };
  }
  const errors: string[] = [];

  const summary = asNonEmptyString(record.summary);
  if (!summary) {
    errors.push("summary is required");
  }
  const decisions = Array.isArray(record.decisions)
    ? record.decisions.map((d) => asNonEmptyString(d)).filter((d): d is string => d !== null)
    : [];

  const actionItems: TaskCandidate[] = [];
  if (record.actionItems !== undefined) {
    if (!Array.isArray(record.actionItems)) {
      errors.push("actionItems must be an array");
    } else {
      record.actionItems.forEach((item, index) => {
        const validated = validateTaskCandidate(item);
        if (validated.ok) {
          actionItems.push(validated.value);
        } else {
          errors.push(`actionItems[${index}]: ${validated.errors.join("; ")}`);
        }
      });
    }
  }

  if (errors.length > 0 || !summary) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { kind: "minutes_draft", summary, decisions, actionItems },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Candidate -> authoritative write input (owner stamped server-side)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The deterministic input for a confirmed schedule write. Structurally compatible
 * with `buildManualScheduleEntry` (schedule-store) minus `id`/`kind`, which the
 * store stamps. `ownerUserId`/`tenantId` come from the resolved actor — NEVER the
 * candidate — which is what makes confirmation safe against LLM-injected owners.
 */
export type ConfirmedScheduleEntryInput = {
  ownerUserId: string;
  tenantId?: string;
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone: string;
};

/**
 * Maps a validated ScheduleEntryCandidate to a confirmed write input, stamping the
 * caller-supplied owner/tenant. The candidate's timestamps are already validated as
 * parseable, so the ms conversion is total.
 */
export function scheduleEntryCandidateToConfirmedInput(
  candidate: ScheduleEntryCandidate,
  ctx: { ownerUserId: string; tenantId?: string },
): ConfirmedScheduleEntryInput {
  const endAtMs = candidate.endAt ? new Date(candidate.endAt).getTime() : undefined;
  return {
    ownerUserId: ctx.ownerUserId,
    ...(ctx.tenantId !== undefined ? { tenantId: ctx.tenantId } : {}),
    title: candidate.title,
    startAtMs: new Date(candidate.startAt).getTime(),
    ...(endAtMs !== undefined ? { endAtMs } : {}),
    timezone: candidate.timezone ?? "UTC",
  };
}
