/**
 * Batch 11 S0 — OGUI decision record (session authority).
 *
 * Protocol names on `ogui-answer` / projected `ogui-form` (snake_case):
 *   decision_id      ↔ decisionId
 *   decision_version ↔ version
 *   submission_id    stays the per-attempt chat.send idempotency key
 *
 * The fence fields are references. Authority is this record plus the
 * authenticated identity (E4). `updateSessionStore` is the only writer
 * (`src/config/sessions/store.ts`). The lifecycle engine calls it when the
 * flag is on. Flag-off code does not.
 *
 * E1 keeps two axes:
 *   decisionStatus — waiting | answered | rejected | expired | superseded
 *   resumeStatus   — pending | running | completed | retryable
 * `skipped` is a deferral on a still-waiting decision, not a terminal status.
 * Close / dismiss is display-only and is not a decisionStatus.
 * `conflict` is a submit result, not a stored decisionStatus.
 */

export const OGUI_DECISION_STATUSES = [
  "waiting",
  "answered",
  "rejected",
  "expired",
  "superseded",
] as const;

export type OguiDecisionStatus = (typeof OGUI_DECISION_STATUSES)[number];

/** Deferral while the decision stays `waiting`. Not a terminal status. */
export const OGUI_DECISION_DEFERRAL_SKIPPED = "skipped" as const;

export type OguiDecisionDeferral = typeof OGUI_DECISION_DEFERRAL_SKIPPED;

export const OGUI_RESUME_STATUSES = ["pending", "running", "completed", "retryable"] as const;

export type OguiResumeStatus = (typeof OGUI_RESUME_STATUSES)[number];

export type OguiDecisionAnswerKind = "option" | "custom" | "reject";

export type OguiDecisionAnswer = {
  kind: OguiDecisionAnswerKind;
  value: string;
  label?: string;
  submissionIds: string[];
};

export type OguiDecisionOption = {
  /** Logical id. Protocol option `value` maps here. */
  value: string;
  label: string;
  style?: string;
};

export type OguiDecisionScope = {
  sessionKey: string;
  /** Authenticated identity only. Never copy this from a fence or answer (E4). */
  userId: string;
  taskContextId?: string;
  /** Run that issued the card (E4). */
  originRunId: string;
  originUserMessageRef?: string;
};

export type OguiDecisionRecord = {
  decisionId: string;
  version: number;
  decisionStatus: OguiDecisionStatus;
  /**
   * Set when the user chose later / skip. decisionStatus stays `waiting`.
   * Close / dismiss must not set this field.
   */
  deferral?: OguiDecisionDeferral;
  resumeStatus: OguiResumeStatus;
  /** Stable resume identity. Retries reuse it; a second mainline is not minted. */
  resumeRef: string;
  scope: OguiDecisionScope;
  prompt: string;
  /**
   * Same semantic proposal re-entry reuses decisionId (D23).
   * Absent on records written before the engine existed.
   */
  proposalKey?: string;
  options: OguiDecisionOption[];
  allowCustom: boolean;
  /** Hard false. `true` is an explicit reject, not a silent single-select. */
  multiSelect: false;
  answer?: OguiDecisionAnswer;
  expiresAtMs?: number;
  issuedAtMs: number;
  updatedAtMs: number;
};

/** Keyed by decisionId. */
export type OguiDecisionMap = Record<string, OguiDecisionRecord>;

export type OguiDecisionUserGesture = "answer" | "reject" | "skip" | "close" | "dismiss";

export type OguiDecisionGestureProjection =
  | { write: false; reason: "display_only" }
  | { write: true; decisionStatus: "waiting"; deferral: OguiDecisionDeferral }
  | { write: true; decisionStatus: "answered" | "rejected" };

const DECISION_STATUS_SET = new Set<string>(OGUI_DECISION_STATUSES);
const RESUME_STATUS_SET = new Set<string>(OGUI_RESUME_STATUSES);
const ANSWER_KINDS = new Set<string>(["option", "custom", "reject"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function parseScope(raw: unknown): OguiDecisionScope | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const sessionKey = nonEmpty(raw.sessionKey);
  const userId = nonEmpty(raw.userId);
  const originRunId = nonEmpty(raw.originRunId);
  if (!sessionKey || !userId || !originRunId) {
    return undefined;
  }
  const taskContextId = nonEmpty(raw.taskContextId);
  const originUserMessageRef = nonEmpty(raw.originUserMessageRef);
  return {
    sessionKey,
    userId,
    originRunId,
    ...(taskContextId ? { taskContextId } : {}),
    ...(originUserMessageRef ? { originUserMessageRef } : {}),
  };
}

function parseOptions(raw: unknown): OguiDecisionOption[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) {
    return undefined;
  }
  const options: OguiDecisionOption[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      return undefined;
    }
    const value = nonEmpty(item.value);
    const label = nonEmpty(item.label);
    if (!value || !label) {
      return undefined;
    }
    const style = nonEmpty(item.style);
    options.push(style ? { value, label, style } : { value, label });
  }
  return options;
}

function parseAnswer(raw: unknown): OguiDecisionAnswer | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const kind = nonEmpty(raw.kind);
  const value = nonEmpty(raw.value);
  if (!ANSWER_KINDS.has(kind) || !value || !Array.isArray(raw.submissionIds)) {
    return undefined;
  }
  if (raw.submissionIds.length === 0) {
    return undefined;
  }
  const submissionIds: string[] = [];
  for (const id of raw.submissionIds) {
    const trimmed = nonEmpty(id);
    if (!trimmed) {
      return undefined;
    }
    submissionIds.push(trimmed);
  }
  const label = nonEmpty(raw.label);
  return {
    kind: kind as OguiDecisionAnswerKind,
    value,
    submissionIds,
    ...(label ? { label } : {}),
  };
}

/**
 * Validate a persisted decision record. Returns a normalized copy, or
 * undefined when the shape is not a legal two-axis record.
 * `skipped`, `close`, `dismiss`, and `conflict` are not decisionStatus values.
 */
export function parseOguiDecisionRecord(raw: unknown): OguiDecisionRecord | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const decisionId = nonEmpty(raw.decisionId);
  if (!decisionId || !isPositiveInt(raw.version)) {
    return undefined;
  }
  if (typeof raw.decisionStatus !== "string" || !DECISION_STATUS_SET.has(raw.decisionStatus)) {
    return undefined;
  }
  if (typeof raw.resumeStatus !== "string" || !RESUME_STATUS_SET.has(raw.resumeStatus)) {
    return undefined;
  }
  const resumeRef = nonEmpty(raw.resumeRef);
  const prompt = nonEmpty(raw.prompt);
  if (!resumeRef || !prompt || typeof raw.allowCustom !== "boolean" || raw.multiSelect !== false) {
    return undefined;
  }
  if (raw.deferral !== undefined) {
    if (raw.deferral !== OGUI_DECISION_DEFERRAL_SKIPPED || raw.decisionStatus !== "waiting") {
      return undefined;
    }
  }
  const scope = parseScope(raw.scope);
  const options = parseOptions(raw.options);
  const issuedAtMs = nonNegativeInt(raw.issuedAtMs);
  const updatedAtMs = nonNegativeInt(raw.updatedAtMs);
  if (!scope || !options || issuedAtMs === undefined || updatedAtMs === undefined) {
    return undefined;
  }
  let proposalKey: string | undefined;
  if (raw.proposalKey !== undefined) {
    proposalKey = nonEmpty(raw.proposalKey);
    if (!proposalKey) {
      return undefined;
    }
  }
  let expiresAtMs: number | undefined;
  if (raw.expiresAtMs !== undefined) {
    expiresAtMs = nonNegativeInt(raw.expiresAtMs);
    if (expiresAtMs === undefined) {
      return undefined;
    }
  }
  let answer: OguiDecisionAnswer | undefined;
  if (raw.answer !== undefined) {
    answer = parseAnswer(raw.answer);
    if (!answer) {
      return undefined;
    }
  }
  return {
    decisionId,
    version: raw.version,
    decisionStatus: raw.decisionStatus as OguiDecisionStatus,
    ...(raw.deferral === OGUI_DECISION_DEFERRAL_SKIPPED ? { deferral: "skipped" } : {}),
    resumeStatus: raw.resumeStatus as OguiResumeStatus,
    resumeRef,
    scope,
    prompt,
    ...(proposalKey ? { proposalKey } : {}),
    options,
    allowCustom: raw.allowCustom,
    multiSelect: false,
    ...(answer ? { answer } : {}),
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
    issuedAtMs,
    updatedAtMs,
  };
}

/** Parse a decisionId-keyed map. A key that disagrees with record.decisionId fails the whole map. */
export function parseOguiDecisionMap(raw: unknown): OguiDecisionMap | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const map: OguiDecisionMap = {};
  for (const [key, value] of Object.entries(raw)) {
    const record = parseOguiDecisionRecord(value);
    if (!record || record.decisionId !== key) {
      return undefined;
    }
    map[key] = record;
  }
  return map;
}

/**
 * Map a user gesture onto the decision axis.
 * Close and dismiss write nothing. Skip stays waiting and records deferral.
 */
export function projectOguiDecisionGesture(
  gesture: OguiDecisionUserGesture,
): OguiDecisionGestureProjection {
  if (gesture === "close" || gesture === "dismiss") {
    return { write: false, reason: "display_only" };
  }
  if (gesture === "skip") {
    return { write: true, decisionStatus: "waiting", deferral: "skipped" };
  }
  if (gesture === "reject") {
    return { write: true, decisionStatus: "rejected" };
  }
  return { write: true, decisionStatus: "answered" };
}
