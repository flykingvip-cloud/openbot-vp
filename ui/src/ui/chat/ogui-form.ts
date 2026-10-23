/**
 * OGUI Form P0 — stage-1 `single_select` (ogui/v1).
 *
 * Fence contract (assistant emit):
 *   ```ogui-form
 *   { schema_version, component_id, fields:[{id,label,type:"single_select",options:[{value,label}]}] }
 *   ```
 *
 * Submit (user → chat.send via handleSendChat): readable summary + ```ogui-answer``` fence.
 * ChatSendParamsSchema is NOT expanded. submission_id is both in the fence and passed as
 * chat.send idempotencyKey (existing Gateway field — no schema widen). Distinct from
 * Interactive Choice Follow-up (#665 NL 「你选」).
 *
 * Non-goals: multi_select, Wizard, Canvas, mobile, ui.* RPC, LIVE defaults, Steward bypass.
 */

export const OGUI_SCHEMA_VERSION = "ogui/v1" as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OGUI_FORM_FENCE_RE = /```\s*ogui-form\s*\r?\n([\s\S]*?)```/i;
const OGUI_FORM_FENCE_GLOBAL_RE = /```\s*ogui-form\s*\r?\n([\s\S]*?)```/gi;
const OGUI_ANSWER_FENCE_RE = /```\s*ogui-answer\s*\r?\n([\s\S]*?)```/i;

export type OguiFormOption = Readonly<{
  value: string;
  label: string;
}>;

export type OguiFormField = Readonly<{
  id: string;
  label: string;
  type: "single_select";
  options: readonly OguiFormOption[];
  required?: boolean;
}>;

export type OguiFormDefinition = Readonly<{
  schema_version: typeof OGUI_SCHEMA_VERSION;
  component_id: string;
  fields: readonly OguiFormField[];
  /** Optional human title shown above fields. */
  title?: string;
  /** Submit button label (default 「提交」). */
  submit_label?: string;
  /**
   * Optional server projection. Protocol `decision_id` ↔ logical decisionId.
   * Present only together with `decision_version`. Reference, not authority.
   */
  decision_id?: string;
  /** Protocol `decision_version` ↔ logical version. Positive integer. */
  decision_version?: number;
  /** Lifecycle card accepts one explicit custom string. */
  allowCustom?: boolean;
}>;

export type OguiAnswerEnvelope = Readonly<{
  schema_version: typeof OGUI_SCHEMA_VERSION;
  component_id: string;
  submission_id: string;
  answers: Readonly<Record<string, string>>;
  /** Present when the form distinguishes option vs custom submit. */
  answer_mode?: "option" | "custom";
  submitted_at?: string;
  /** Lifecycle reference. Omit both decision fields for legacy OGUI (Ev1). */
  decision_id?: string;
  /** Lifecycle reference. Positive integer. Logical name: version. */
  decision_version?: number;
}>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract the first ```ogui-form ... ``` fence body, or null. */
export function extractOguiFormFenceBody(text: string): string | null {
  if (!text || typeof text !== "string") {
    return null;
  }
  const match = OGUI_FORM_FENCE_RE.exec(text);
  if (!match) {
    return null;
  }
  const body = match[1]?.trim() ?? "";
  return body.length > 0 ? body : null;
}

/**
 * Strip all ```ogui-form``` fences from assistant markdown so the raw JSON
 * is not double-rendered when the interactive Form UI is shown.
 */
export function stripOguiFormFences(text: string): string {
  if (!text) {
    return text;
  }
  return text
    .replace(OGUI_FORM_FENCE_GLOBAL_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseOption(raw: unknown): OguiFormOption | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const value = typeof raw.value === "string" ? raw.value.trim() : "";
  const label =
    typeof raw.label === "string"
      ? raw.label.trim()
      : typeof raw.name === "string"
        ? raw.name.trim()
        : "";
  if (!value || !label) {
    return null;
  }
  return { value, label };
}

function parseField(raw: unknown): OguiFormField | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const type = typeof raw.type === "string" ? raw.type.trim() : "";
  if (!id || !label || type !== "single_select") {
    return null;
  }
  if (!Array.isArray(raw.options) || raw.options.length === 0) {
    return null;
  }
  const options: OguiFormOption[] = [];
  for (const opt of raw.options) {
    const parsed = parseOption(opt);
    if (!parsed) {
      return null;
    }
    options.push(parsed);
  }
  const required = raw.required !== false;
  return { id, label, type: "single_select", options, required };
}

/**
 * Validate a parsed JSON value as ogui/v1 form definition (P0 single_select only).
 * Invalid / incomplete → null (safe degrade; never throw into chat path).
 */
export function parseOguiFormDefinition(raw: unknown): OguiFormDefinition | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  // Canonical: schema_version "ogui/v1". Alias: version === 1 (handoff §4).
  const versionOk =
    raw.schema_version === OGUI_SCHEMA_VERSION || raw.version === 1 || raw.version === "1";
  if (!versionOk) {
    return null;
  }
  if (raw.type !== undefined && raw.type !== "form") {
    return null;
  }
  const componentIdRaw =
    typeof raw.component_id === "string"
      ? raw.component_id
      : typeof raw.form_id === "string"
        ? raw.form_id
        : typeof raw.id === "string"
          ? raw.id
          : "";
  const componentId = componentIdRaw.trim();
  if (!componentId) {
    return null;
  }
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
    return null;
  }
  const fields: OguiFormField[] = [];
  for (const field of raw.fields) {
    const parsed = parseField(field);
    if (!parsed) {
      return null;
    }
    fields.push(parsed);
  }
  const decisionRef = readPairedDecisionRef(raw);
  const allowCustom = raw.allow_custom === true || raw.allowCustom === true;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined;
  const submitLabel =
    typeof raw.submit_label === "string" && raw.submit_label.trim()
      ? raw.submit_label.trim()
      : isPlainObject(raw.submit) && typeof raw.submit.label === "string" && raw.submit.label.trim()
        ? raw.submit.label.trim()
        : undefined;
  return {
    schema_version: OGUI_SCHEMA_VERSION,
    component_id: componentId,
    fields,
    ...(title ? { title } : {}),
    ...(submitLabel ? { submit_label: submitLabel } : {}),
    ...(allowCustom ? { allowCustom: true } : {}),
    ...decisionRef,
  };
}

/**
 * Both decision fields or neither. A half-present projection is dropped so
 * the form still renders; it is not a consume.
 */
function readPairedDecisionRef(
  raw: Record<string, unknown>,
): { decision_id: string; decision_version: number } | undefined {
  if (raw.decision_id === undefined && raw.decision_version === undefined) {
    return undefined;
  }
  const decisionId = typeof raw.decision_id === "string" ? raw.decision_id.trim() : "";
  const version = raw.decision_version;
  if (!decisionId || typeof version !== "number" || !Number.isInteger(version) || version <= 0) {
    return undefined;
  }
  return { decision_id: decisionId, decision_version: version };
}

function readSubmitDecisionRef(input: {
  decisionId?: string;
  decisionVersion?: number;
}): { decision_id: string; decision_version: number } | undefined {
  if (input.decisionId === undefined && input.decisionVersion === undefined) {
    return undefined;
  }
  const decisionId = input.decisionId?.trim() ?? "";
  const version = input.decisionVersion;
  if (!decisionId || typeof version !== "number" || !Number.isInteger(version) || version <= 0) {
    throw new Error(
      "buildOguiAnswerSubmitMessage: lifecycle answer requires decisionId and a positive integer decisionVersion",
    );
  }
  return { decision_id: decisionId, decision_version: version };
}

/**
 * Decision ref on a sent ```ogui-answer``` fence.
 * Both fields are required. A legacy answer and a half-present pair return undefined.
 */
export function readOguiAnswerDecisionRef(
  text: string,
): { decision_id: string; decision_version: number } | undefined {
  if (!text || typeof text !== "string") {
    return undefined;
  }
  const match = OGUI_ANSWER_FENCE_RE.exec(text);
  const body = match?.[1]?.trim() ?? "";
  if (!body) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) {
    return undefined;
  }
  return readPairedDecisionRef(parsed);
}

/** Parse the first legal ogui-form fence from chat text; illegal → null. */
export function parseOguiFormFromText(text: string): OguiFormDefinition | null {
  const body = extractOguiFormFenceBody(text);
  if (!body) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  return parseOguiFormDefinition(parsed);
}

/** True when text carries a parseable P0 ogui-form (Form UI can render). */
export function hasRenderableOguiForm(text: string): boolean {
  return parseOguiFormFromText(text) !== null;
}

export type BuildOguiAnswerSubmitInput = {
  form: OguiFormDefinition;
  /** fieldId → option value (not label). */
  answers: Readonly<Record<string, string>>;
  /** UUID; generated by the renderer if omitted. */
  submissionId: string;
  submittedAt?: string;
  /**
   * Lifecycle card reference (protocol `decision_id`).
   * Omit together with decisionVersion for legacy OGUI.
   * A lifecycle card sets both.
   */
  decisionId?: string;
  /** Protocol `decision_version`. Positive integer. */
  decisionVersion?: number;
  /** Option click vs the explicit custom field. Omitted stays an option submit. */
  answerMode?: "option" | "custom";
};

/**
 * Build the user turn: readable summary + ```ogui-answer``` fence.
 * Answers map fieldId → option **value**; summary shows labels when possible.
 */
export function buildOguiAnswerSubmitMessage(input: BuildOguiAnswerSubmitInput): string {
  const submissionId = input.submissionId.trim();
  if (!UUID_RE.test(submissionId)) {
    throw new Error("buildOguiAnswerSubmitMessage: submissionId must be a UUID");
  }
  const answers: Record<string, string> = {};
  const summaryLines: string[] = ["请基于以下表单选择继续完成任务：", ""];
  if (input.form.title) {
    summaryLines.push(`表单：${input.form.title}`, "");
  }
  for (const field of input.form.fields) {
    const value = input.answers[field.id]?.trim() ?? "";
    if (!value) {
      if (field.required !== false) {
        throw new Error(`buildOguiAnswerSubmitMessage: missing required field ${field.id}`);
      }
      continue;
    }
    const option = field.options.find((o) => o.value === value);
    answers[field.id] = value;
    const shown = option ? option.label : value;
    summaryLines.push(`${field.id}（${field.label}）：${shown}`);
  }
  if (Object.keys(answers).length === 0) {
    throw new Error("buildOguiAnswerSubmitMessage: no answers");
  }
  summaryLines.push("");
  summaryLines.push("请据此继续原任务。不要重复询问已回答的问题。");
  summaryLines.push("");

  const decisionRef = readSubmitDecisionRef(input);
  const envelope: OguiAnswerEnvelope = {
    schema_version: OGUI_SCHEMA_VERSION,
    component_id: input.form.component_id,
    submission_id: submissionId,
    answers,
    ...(input.answerMode ? { answer_mode: input.answerMode } : {}),
    ...(input.submittedAt?.trim() ? { submitted_at: input.submittedAt.trim() } : {}),
    ...decisionRef,
  };

  return [...summaryLines, "```ogui-answer", JSON.stringify(envelope, null, 2), "```"].join("\n");
}

/** Stable panel id for draft selection across lit re-renders. */
export function oguiFormPanelId(form: OguiFormDefinition): string {
  return `${form.component_id}\u0000${form.fields.map((f) => f.id).join("\u0001")}`;
}

/** Whether every required field has a non-empty draft answer. */
export function oguiFormDraftComplete(
  form: OguiFormDefinition,
  draft: Readonly<Record<string, string>>,
): boolean {
  for (const field of form.fields) {
    if (field.required === false) {
      continue;
    }
    if (!draft[field.id]?.trim()) {
      return false;
    }
  }
  return form.fields.some((f) => Boolean(draft[f.id]?.trim()));
}
