/**
 * C4 — OGUI 拍板 → handoff 上下文投影（2026-10-13）。
 *
 * Inventory (main @ Form P0 #672):
 *   - `ogui-form` / `ogui-answer` fences: Form P0 single_select in control-ui
 *     (`ui/src/ui/chat/ogui-form*.ts`). Interactive Choice (#665) remains NL path.
 *   - HandoffContract propose → accept → approve → apply: EXISTS (flag-off).
 *   - ChatSendParamsSchema stays closed; no `ui.*` RPC.
 *
 * Seam (#670) + thin wire (this follow-up):
 *   - Parse a legal `ogui-answer` fence when it appears in chat text.
 *   - Project submitted answers into a readable handoff brief (projection input).
 *   - Flag `collaboration.task.oguiHandoffProjection` default **OFF** (fail-closed).
 *   - chat.send best-effort store under `<ns>/ogui-projections`; proposeHandoff
 *     appends latest brief into assumptions when flag ON.
 *
 * Non-goals: Form UI changes, ChatSendParamsSchema expand, ui.* RPC, Floor live,
 * Steward / Exec Approvals bypass, multi_select, Wizard adapter.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { appendJsonlDurable, withRoundLock } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";

export const OGUI_SCHEMA_VERSION = "ogui/v1" as const;

export type OguiAnswerEnvelope = Readonly<{
  schema_version: typeof OGUI_SCHEMA_VERSION;
  component_id: string;
  submission_id: string;
  answers: Readonly<Record<string, string>>;
  submitted_at?: string;
}>;

export type OguiProjectionResult =
  | { ok: true; value: { envelope: OguiAnswerEnvelope; handoffBrief: string } }
  | { ok: false; reason: string; message: string };

export type OguiProjectionRecord = Readonly<{
  projectionId: string;
  groupId: string;
  submissionId: string;
  componentId: string;
  handoffBrief: string;
  answers: Readonly<Record<string, string>>;
  at: number;
  taskId?: string;
  relatedId?: string;
  fromAgentId?: string;
  submittedAt?: string;
}>;

type OguiProjectionLogLine = {
  kind: "ogui_answer_projection";
  at: number;
  record: OguiProjectionRecord;
};

export type OguiProjectionStoreOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Fence opener: ```ogui-answer  (optional language suffix whitespace). */
const OGUI_ANSWER_FENCE_RE = /```\s*ogui-answer\s*\r?\n([\s\S]*?)```/i;

/**
 * Plan flag `collab.task.oguiHandoffProjection`
 * → `collaboration.task.oguiHandoffProjection` (default false).
 */
export function isCollabTaskOguiHandoffProjectionEnabled(cfg?: OpenBotConfig): boolean {
  try {
    return (cfg ?? loadConfig()).collaboration?.task?.oguiHandoffProjection === true;
  } catch {
    return false;
  }
}

/**
 * Inventory: OGUI Form P0 (`ogui-form` / `ogui-answer` + control-ui single_select)
 * is present after the Form P0 PR. C4 projection flag remains default OFF.
 */
export function oguiFormUiPresentOnMain(): boolean {
  return true;
}

function fail(reason: string, message: string): OguiProjectionResult {
  return { ok: false, reason, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function safeStem(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return encodeURIComponent(trimmed);
}

function newProjectionId(nowMs: number): string {
  return `ogui_${nowMs}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Extract the first ```ogui-answer ... ``` fence body from chat text.
 * Returns null when absent (non-ogui fences ignored).
 */
export function extractOguiAnswerFenceBody(text: string): string | null {
  if (!text || typeof text !== "string") {
    return null;
  }
  const match = OGUI_ANSWER_FENCE_RE.exec(text);
  if (!match) {
    return null;
  }
  const body = match[1]?.trim() ?? "";
  return body.length > 0 ? body : null;
}

/**
 * Validate a parsed JSON value as ogui/v1 answer envelope.
 * Invalid / incomplete → null (safe degrade; never throw into chat path).
 */
export function parseOguiAnswerEnvelope(raw: unknown): OguiAnswerEnvelope | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (raw.schema_version !== OGUI_SCHEMA_VERSION) {
    return null;
  }
  if (raw.type !== undefined && raw.type !== "answer") {
    // Optional discriminant; reject explicit non-answer types.
    return null;
  }
  const componentId = typeof raw.component_id === "string" ? raw.component_id.trim() : "";
  const submissionId = typeof raw.submission_id === "string" ? raw.submission_id.trim() : "";
  if (!componentId || !UUID_RE.test(submissionId)) {
    return null;
  }
  if (!isPlainObject(raw.answers)) {
    return null;
  }
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.answers)) {
    const fieldId = key.trim();
    if (!fieldId || typeof value !== "string" || !value.trim()) {
      return null;
    }
    answers[fieldId] = value.trim();
  }
  if (Object.keys(answers).length === 0) {
    return null;
  }
  const submittedAt =
    typeof raw.submitted_at === "string" && raw.submitted_at.trim()
      ? raw.submitted_at.trim()
      : undefined;
  return {
    schema_version: OGUI_SCHEMA_VERSION,
    component_id: componentId,
    submission_id: submissionId,
    answers,
    ...(submittedAt ? { submitted_at: submittedAt } : {}),
  };
}

/**
 * Project submitted answers into a readable handoff / coordinator brief.
 * This is **projection input** only — never a control instruction / approval bypass.
 */
export function formatOguiAnswersAsHandoffBrief(envelope: OguiAnswerEnvelope): string {
  const lines: string[] = [
    "【OGUI 拍板投影 — 只读上下文，非控制指令】",
    `component_id: ${envelope.component_id}`,
    `submission_id: ${envelope.submission_id}`,
  ];
  if (envelope.submitted_at) {
    lines.push(`submitted_at: ${envelope.submitted_at}`);
  }
  lines.push("answers:");
  for (const [fieldId, value] of Object.entries(envelope.answers)) {
    lines.push(`- ${fieldId}: ${value}`);
  }
  lines.push(
    "说明：以上为用户已提交的 OGUI 答案投影，供协调者下一棒 handoff 上下文使用；不得旁路 Steward / Exec Approvals / Admission。",
  );
  return lines.join("\n");
}

/**
 * Parse chat text for a legal ogui-answer fence and (when flag ON) project it.
 * Flag-off / missing fence / invalid JSON → fail-closed result (no throw).
 */
export function projectOguiAnswerToHandoffContext(
  text: string,
  cfg?: OpenBotConfig,
): OguiProjectionResult {
  if (!isCollabTaskOguiHandoffProjectionEnabled(cfg)) {
    return fail(
      "flag_off",
      "collaboration.task.oguiHandoffProjection is off; OGUI→handoff projection does not run",
    );
  }
  const body = extractOguiAnswerFenceBody(text);
  if (!body) {
    return fail("fence_absent", "no ogui-answer fence in text");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return fail("invalid_json", "ogui-answer fence body is not valid JSON; degrade to ignore");
  }
  const envelope = parseOguiAnswerEnvelope(parsed);
  if (!envelope) {
    return fail(
      "invalid_envelope",
      "ogui-answer failed schema_version/answers/submission_id checks",
    );
  }
  return {
    ok: true,
    value: {
      envelope,
      handoffBrief: formatOguiAnswersAsHandoffBrief(envelope),
    },
  };
}

/**
 * Inventory helper: does this text look like it carries an ogui-form definition fence?
 * Used by Form UI + freeze tests. Form P0 lands alongside this seam.
 */
export function extractOguiFormFenceBody(text: string): string | null {
  if (!text || typeof text !== "string") {
    return null;
  }
  const match = /```\s*ogui-form\s*\r?\n([\s\S]*?)```/i.exec(text);
  if (!match) {
    return null;
  }
  const body = match[1]?.trim() ?? "";
  return body.length > 0 ? body : null;
}

/** Projections live under `<ns>/ogui-projections` (alongside wake-events / handoffs). */
export function oguiProjectionsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "ogui-projections");
}

export function oguiProjectionLogPath(projectionsDir: string, groupId: string): string {
  const stem = safeStem(groupId);
  if (!stem) {
    throw new Error("ogui projection groupId is not a safe id");
  }
  return path.join(projectionsDir, `${stem}.jsonl`);
}

function isOguiProjectionRecord(value: unknown): value is OguiProjectionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as OguiProjectionRecord;
  return (
    typeof record.projectionId === "string" &&
    typeof record.groupId === "string" &&
    typeof record.submissionId === "string" &&
    typeof record.componentId === "string" &&
    typeof record.handoffBrief === "string" &&
    typeof record.at === "number" &&
    !!record.answers &&
    typeof record.answers === "object"
  );
}

async function readProjectionLog(logPath: string): Promise<OguiProjectionLogLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines: OguiProjectionLogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as OguiProjectionLogLine;
      if (parsed?.kind === "ogui_answer_projection" && isOguiProjectionRecord(parsed.record)) {
        lines.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  return lines;
}

/**
 * Append handoffBrief into assumptions when not already present.
 * Missing brief → return assumptions unchanged (deduped).
 */
export function enrichHandoffAssumptionsWithOguiBrief(params: {
  assumptions?: readonly string[];
  handoffBrief: string | null | undefined;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of params.assumptions ?? []) {
    const id = compactId(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  const brief = compactId(params.handoffBrief);
  if (brief && !seen.has(brief)) {
    out.push(brief);
  }
  return out;
}

/**
 * Pure enricher: when flag ON and `sourceChatText` carries a legal ogui-answer,
 * append the projected brief to assumptions. Illegal / flag-off → unchanged.
 */
export function enrichProposeContextWithOguiAnswer(params: {
  assumptions?: readonly string[];
  sourceChatText?: string;
  cfg?: OpenBotConfig;
}): { assumptions: string[]; projected: boolean; reason?: string } {
  const base = enrichHandoffAssumptionsWithOguiBrief({
    assumptions: params.assumptions,
    handoffBrief: null,
  });
  const text = params.sourceChatText;
  if (!text || typeof text !== "string") {
    return { assumptions: base, projected: false, reason: "source_absent" };
  }
  const result = projectOguiAnswerToHandoffContext(text, params.cfg);
  if (!result.ok) {
    return { assumptions: base, projected: false, reason: result.reason };
  }
  return {
    assumptions: enrichHandoffAssumptionsWithOguiBrief({
      assumptions: base,
      handoffBrief: result.value.handoffBrief,
    }),
    projected: true,
  };
}

export type RecordOguiProjectionInput = {
  groupId: string;
  message: string;
  taskId?: string;
  relatedId?: string;
  fromAgentId?: string;
  projectionId?: string;
};

/**
 * Flag-gated write: legal ogui-answer in message → persist handoff brief.
 * Flag-off / illegal fence → fail-closed (no throw, no disk write on flag-off).
 */
export async function recordOguiAnswerProjection(
  authority: RuntimeAuthority,
  input: RecordOguiProjectionInput,
  options?: OguiProjectionStoreOptions,
): Promise<OguiProjectionResult & { record?: OguiProjectionRecord }> {
  const cfg = options?.cfg;
  const projected = projectOguiAnswerToHandoffContext(input.message, cfg);
  if (!projected.ok) {
    return projected;
  }
  const groupId = compactId(input.groupId) || compactId(authority.groupId);
  if (!groupId || !safeStem(groupId)) {
    return fail("invalid_input", "recordOguiAnswerProjection requires a safe groupId");
  }
  const at = options?.nowMs ?? Date.now();
  const record: OguiProjectionRecord = {
    projectionId: compactId(input.projectionId) || newProjectionId(at),
    groupId,
    submissionId: projected.value.envelope.submission_id,
    componentId: projected.value.envelope.component_id,
    handoffBrief: projected.value.handoffBrief,
    answers: projected.value.envelope.answers,
    at,
    ...(compactId(input.taskId) ? { taskId: compactId(input.taskId) } : {}),
    ...(compactId(input.relatedId) ? { relatedId: compactId(input.relatedId) } : {}),
    ...(compactId(input.fromAgentId) ? { fromAgentId: compactId(input.fromAgentId) } : {}),
    ...(projected.value.envelope.submitted_at
      ? { submittedAt: projected.value.envelope.submitted_at }
      : {}),
  };
  const dir = oguiProjectionsDir(authority);
  assertCollaborationRuntimeWritable(dir, cfg);
  const stem = safeStem(groupId)!;
  const logPath = oguiProjectionLogPath(dir, groupId);
  await withRoundLock(dir, stem, async () => {
    await fs.mkdir(dir, { recursive: true });
    await appendJsonlDurable(logPath, {
      kind: "ogui_answer_projection",
      at,
      record,
    } satisfies OguiProjectionLogLine);
  });
  return { ok: true, value: projected.value, record };
}

/** Best-effort wrapper for chat hot path — never throws. */
export async function recordOguiAnswerProjectionBestEffort(
  authority: RuntimeAuthority,
  input: RecordOguiProjectionInput,
  options?: OguiProjectionStoreOptions,
): Promise<OguiProjectionRecord | null> {
  try {
    const result = await recordOguiAnswerProjection(authority, input, options);
    return result.ok && result.record ? result.record : null;
  } catch {
    return null;
  }
}

/** Newest-first list (flag does not gate reads — observe AS-IS like wake list). */
export async function listOguiAnswerProjections(
  authority: RuntimeAuthority,
  params?: { groupId?: string; taskId?: string; limit?: number },
): Promise<OguiProjectionRecord[]> {
  const groupId = compactId(params?.groupId) || compactId(authority.groupId);
  if (!groupId || !safeStem(groupId)) {
    return [];
  }
  const logPath = oguiProjectionLogPath(oguiProjectionsDir(authority), groupId);
  const lines = await readProjectionLog(logPath);
  const taskId = compactId(params?.taskId);
  const records = lines
    .map((line) => line.record)
    .filter((record) => (taskId ? compactId(record.taskId) === taskId : true))
    .toSorted((a, b) => b.at - a.at);
  const limit = params?.limit;
  if (typeof limit === "number" && limit > 0) {
    return records.slice(0, limit);
  }
  return records;
}

/** Latest projection for group (optionally filtered by taskId). */
export async function latestOguiAnswerProjection(
  authority: RuntimeAuthority,
  params?: { groupId?: string; taskId?: string },
): Promise<OguiProjectionRecord | null> {
  const list = await listOguiAnswerProjections(authority, { ...params, limit: 1 });
  return list[0] ?? null;
}

/**
 * Resolve brief for proposeHandoff: prefer sourceChatText projection, else
 * latest stored projection for task/group. Flag-off → null.
 */
export async function resolveOguiHandoffBriefForPropose(params: {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
  taskId?: string;
  sourceChatText?: string;
}): Promise<string | null> {
  if (!isCollabTaskOguiHandoffProjectionEnabled(params.cfg)) {
    return null;
  }
  if (params.sourceChatText) {
    const projected = projectOguiAnswerToHandoffContext(params.sourceChatText, params.cfg);
    if (projected.ok) {
      return projected.value.handoffBrief;
    }
  }
  try {
    const latest = await latestOguiAnswerProjection(params.authority, {
      taskId: params.taskId,
    });
    if (latest?.handoffBrief) {
      return latest.handoffBrief;
    }
    // Fall back to group-latest when task-scoped miss (chat may omit taskId).
    if (params.taskId) {
      const groupLatest = await latestOguiAnswerProjection(params.authority, {});
      return groupLatest?.handoffBrief ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
