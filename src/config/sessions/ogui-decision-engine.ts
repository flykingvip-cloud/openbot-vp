/**
 * Batch 11 S1–S5 OGUI decision engine.
 *
 * Flag default OFF. Nothing here runs unless
 * `isOguiDecisionLifecycleEnabledFor` is true. There is no PRODUCTION_GO,
 * no LIVE, and no gray open. S1 issue alone is not an external enable.
 *
 * Authority is the session `OguiDecisionRecord` plus the authenticated
 * identity (E4). Fence and answer identity fields are not copied.
 * Every mutation goes through `updateSessionStore`.
 * `submission_id` is chat.send idempotency, not the consume key.
 * Close / dismiss is not a decisionStatus. This file does not add a fence,
 * a queue, or an owner-decision kind.
 */
import crypto from "node:crypto";
import {
  isOguiDecisionLifecycleEnabledFor,
  oguiAnswerHasUntrustedIdentity,
  planOguiDecisionMutation,
  classifyOguiAnswerDecisionFields,
  type OguiDecisionLifecycleConfigSlice,
} from "./ogui-decision-lifecycle.js";
import { replaceOguiSessionWaits } from "./ogui-decision-wait-registry.js";
import {
  parseOguiDecisionMap,
  type OguiDecisionAnswer,
  type OguiDecisionMap,
  type OguiDecisionRecord,
  type OguiResumeStatus,
} from "./ogui-decision.js";
import { loadSessionStore, updateSessionStore } from "./store.js";
import type { SessionEntry } from "./types.js";

export const OGUI_WAIT_PAUSE_TEXT =
  "决策尚未答复，已暂停该任务的续跑。可以提交答案、查看状态、取消、修改或替代决策，或明确开始新目标。";

const ISSUED_CLAIM_TEST = /已签发|签发成功/u;
const ISSUED_CLAIM_RE = /已签发|签发成功/gu;
const FORM_RE = /```[ \t]*ogui-form[ \t]*\r?\n([\s\S]*?)```/i;
const ANSWER_RE = /```[ \t]*ogui-answer[ \t]*\r?\n([\s\S]*?)```/i;

export type OguiDecisionIngress =
  | "chat"
  | "heartbeat"
  | "queue"
  | "retry"
  | "memory"
  | "command"
  | "reset";

export type OguiDecisionRunBinding = {
  lifecycleEnabled: true;
  cfg?: OguiDecisionLifecycleConfigSlice;
  storePath: string;
  sessionKey: string;
  /** Authenticated identity. Never taken from a fence or answer. */
  userId: string;
  originRunId: string;
  agentId?: string;
  tenantId?: string;
  taskContextId?: string;
  originUserMessageRef?: string;
  ingress: OguiDecisionIngress;
  /** Heartbeat and memory flush must not mint a decision. */
  allowIssue: boolean;
  /** Set only after this run has consumed and claimed that decision. */
  decisionId?: string;
  /** Claimed resume this exec must finish. Same id across recover. */
  resumeRef?: string;
};

export type OguiIssueKind = "flag_off" | "not_proposal" | "issued" | "failed" | "historical";

export type OguiIssueOutcome = {
  kind: OguiIssueKind;
  reason?: string;
  decisionId?: string;
  version?: number;
  resumeRef?: string;
  /** Issue persist success ends the turn. The caller must not keep executing. */
  endTurn?: boolean;
  record?: OguiDecisionRecord;
};

type SessionStoreUpdater = typeof updateSessionStore;

type ParsedForm = {
  componentId: string;
  prompt: string;
  proposalKey: string;
  options: { value: string; label: string }[];
};

type FormFence = {
  body: string;
  bodyStart: number;
  bodyEnd: number;
  start: number;
  illustrative: boolean;
};

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function lifecycleOn(input: {
  cfg?: OguiDecisionLifecycleConfigSlice;
  env?: Record<string, string | undefined>;
  agentId?: string;
  tenantId?: string;
}): boolean {
  return isOguiDecisionLifecycleEnabledFor({
    cfg: input.cfg,
    env: input.env,
    subjectIds: [input.tenantId, input.agentId],
  });
}

function allowIssueForIngress(ingress: OguiDecisionIngress): boolean {
  return ingress === "chat" || ingress === "queue" || ingress === "retry" || ingress === "reset";
}

export function resolveOguiDecisionRunBinding(input: {
  cfg?: OguiDecisionLifecycleConfigSlice;
  env?: Record<string, string | undefined>;
  agentId?: string;
  tenantId?: string;
  storePath?: string;
  sessionKey?: string;
  userId?: string;
  originRunId?: string;
  taskContextId?: string;
  originUserMessageRef?: string;
  ingress: OguiDecisionIngress;
}): OguiDecisionRunBinding | undefined {
  if (
    !lifecycleOn(input) ||
    !input.storePath ||
    !input.sessionKey ||
    !input.userId?.trim() ||
    !input.originRunId?.trim()
  ) {
    return undefined;
  }
  return {
    lifecycleEnabled: true,
    cfg: input.cfg,
    storePath: input.storePath,
    sessionKey: input.sessionKey,
    userId: input.userId.trim(),
    originRunId: input.originRunId.trim(),
    agentId: input.agentId,
    tenantId: input.tenantId,
    taskContextId: nonEmpty(input.taskContextId) || undefined,
    originUserMessageRef: nonEmpty(input.originUserMessageRef) || undefined,
    ingress: input.ingress,
    allowIssue: allowIssueForIngress(input.ingress),
  };
}

function fenceIsIllustrative(text: string, start: number): boolean {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const linePrefix = text.slice(lineStart, start);
  if (/^\s*>/.test(linePrefix)) {
    return true;
  }
  const lookbehind = text.slice(Math.max(0, start - 32), start);
  return /例如|引用|举例|计划如下|尚未执行/.test(lookbehind);
}

function findFormFence(text: string): FormFence | undefined {
  const match = FORM_RE.exec(text);
  if (!match || match.index === undefined || match[1] === undefined) {
    return undefined;
  }
  const body = match[1];
  const bodyStart = match.index + match[0].indexOf(body);
  return {
    body,
    bodyStart,
    bodyEnd: bodyStart + body.length,
    start: match.index,
    illustrative: fenceIsIllustrative(text, match.index),
  };
}

function stripFormFences(text: string): string {
  return text
    .replace(/```[ \t]*ogui-form[ \t]*\r?\n[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function explicitMultiSelect(raw: Record<string, unknown>): boolean {
  if (raw.multiSelect === true || raw.multi_select === true) {
    return true;
  }
  if (!Array.isArray(raw.fields)) {
    return false;
  }
  return raw.fields.some((field) => isPlain(field) && field.type === "multi_select");
}

function parseProposal(body: string):
  | { ok: true; form: ParsedForm }
  | {
      ok: false;
      reason:
        | "multi_select_rejected"
        | "high_risk_submit"
        | "invalid_form"
        | "insufficient_options";
    } {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch {
    return { ok: false, reason: "invalid_form" };
  }
  if (!isPlain(raw)) {
    return { ok: false, reason: "invalid_form" };
  }
  if (explicitMultiSelect(raw)) {
    return { ok: false, reason: "multi_select_rejected" };
  }
  if (
    isPlain(raw.submit) &&
    raw.submit.action !== undefined &&
    raw.submit.action !== "continue_agent"
  ) {
    return { ok: false, reason: "high_risk_submit" };
  }
  const versionOk = raw.schema_version === "ogui/v1" || raw.version === 1 || raw.version === "1";
  const componentId = nonEmpty(raw.component_id);
  if (!versionOk || !componentId || !Array.isArray(raw.fields) || raw.fields.length === 0) {
    return { ok: false, reason: "invalid_form" };
  }
  const options: { value: string; label: string }[] = [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const field of raw.fields) {
    if (!isPlain(field) || field.type !== "single_select") {
      return { ok: false, reason: "invalid_form" };
    }
    const label = nonEmpty(field.label);
    if (label) {
      labels.push(label);
    }
    if (!Array.isArray(field.options)) {
      return { ok: false, reason: "invalid_form" };
    }
    for (const option of field.options) {
      if (!isPlain(option)) {
        return { ok: false, reason: "invalid_form" };
      }
      const value = nonEmpty(option.value);
      const optionLabel = nonEmpty(option.label);
      if (!value || !optionLabel || seen.has(value)) {
        return { ok: false, reason: "invalid_form" };
      }
      seen.add(value);
      options.push({ value, label: optionLabel });
    }
  }
  if (options.length < 2) {
    return { ok: false, reason: "insufficient_options" };
  }
  const prompt = nonEmpty(raw.title) || labels.join(" / ") || componentId;
  const proposalKey = `${componentId}\n${prompt}\n${options.map((option) => `${option.value}=${option.label}`).join(",")}`;
  return { ok: true, form: { componentId, prompt, proposalKey, options } };
}

function readMap(entry: SessionEntry | undefined): OguiDecisionMap | undefined {
  if (!entry?.oguiDecisions) {
    return {};
  }
  return parseOguiDecisionMap(entry.oguiDecisions);
}

function waitingForSession(map: OguiDecisionMap, sessionKey: string): OguiDecisionRecord[] {
  return Object.values(map).filter(
    (record) => record.decisionStatus === "waiting" && record.scope.sessionKey === sessionKey,
  );
}

function waitIdsFor(map: OguiDecisionMap, sessionKey: string): string[] {
  return waitingForSession(map, sessionKey).map((record) => record.decisionId);
}

function publishWaits(storePath: string, sessionKey: string): void {
  const map = loadMap(storePath, sessionKey);
  replaceOguiSessionWaits(sessionKey, map ? waitIdsFor(map, sessionKey) : []);
}

function loadMap(storePath: string, sessionKey: string): OguiDecisionMap | undefined {
  const store = loadSessionStore(storePath, { skipCache: true });
  return readMap(store[sessionKey]);
}

export function applyOguiPromiseCardGate(text: string, outcome: OguiIssueOutcome): string {
  if (outcome.kind === "flag_off") {
    return text;
  }
  if (outcome.kind === "issued" && outcome.decisionId && outcome.version) {
    const fence = findFormFence(text);
    if (!fence || fence.illustrative) {
      return text;
    }
    try {
      const value = JSON.parse(fence.body) as unknown;
      if (!isPlain(value)) {
        return stripFailed(text);
      }
      const nextBody = JSON.stringify(
        {
          ...value,
          decision_id: outcome.decisionId,
          decision_version: outcome.version,
          ...(outcome.record?.allowCustom ? { allow_custom: true } : {}),
        },
        null,
        2,
      );
      return `${text.slice(0, fence.bodyStart)}${nextBody}${text.slice(fence.bodyEnd)}`;
    } catch {
      return stripFailed(text);
    }
  }
  const claim = ISSUED_CLAIM_TEST.test(text);
  const fence = findFormFence(text);
  if (outcome.kind === "not_proposal" && !claim && !fence) {
    return text;
  }
  if (outcome.kind === "not_proposal" && fence?.illustrative && !claim) {
    return stripFormFences(text);
  }
  if (outcome.kind === "not_proposal" && !claim) {
    return text;
  }
  if (outcome.kind === "historical") {
    const stripped = stripFormFences(text).replace(ISSUED_CLAIM_RE, "未签发");
    if (stripped.includes("不能重新操作")) {
      return stripped;
    }
    return `${stripped}\n该决策已结束，不能重新操作。`.trim();
  }
  if (outcome.kind === "failed" || claim || (fence && !fence.illustrative)) {
    return stripFailed(text);
  }
  return text;
}

function stripFailed(text: string): string {
  const stripped = stripFormFences(text).replace(ISSUED_CLAIM_RE, "未签发");
  if (stripped.includes("未签发")) {
    return stripped;
  }
  return `${stripped}\n未签发`.trim();
}

export async function issueOguiDecisionFromText(input: {
  text: string;
  binding: OguiDecisionRunBinding;
  nowMs?: number;
  env?: Record<string, string | undefined>;
  updateStore?: SessionStoreUpdater;
}): Promise<OguiIssueOutcome> {
  const enabled = lifecycleOn({ ...input.binding, env: input.env });
  if (!enabled || !input.binding.allowIssue) {
    return { kind: "flag_off" };
  }
  const plan = planOguiDecisionMutation({ kind: "issue", lifecycleEnabled: true });
  if (!plan.ok || !plan.writes) {
    return { kind: "flag_off" };
  }
  const fence = findFormFence(input.text);
  if (!fence || fence.illustrative) {
    return { kind: "not_proposal" };
  }
  const parsed = parseProposal(fence.body);
  if (!parsed.ok) {
    return { kind: "failed", reason: parsed.reason, endTurn: true };
  }
  const now = input.nowMs ?? Date.now();
  const update = input.updateStore ?? updateSessionStore;
  try {
    const stored = await update(input.binding.storePath, (store) => {
      const entry = store[input.binding.sessionKey];
      if (!entry) {
        return { kind: "failed" as const, reason: "missing_session", waitIds: [] as string[] };
      }
      const map = readMap(entry);
      if (!map) {
        return { kind: "failed" as const, reason: "corrupt_map", waitIds: [] as string[] };
      }
      const existing = Object.values(map).find(
        (record) =>
          record.proposalKey === parsed.form.proposalKey &&
          record.scope.sessionKey === input.binding.sessionKey &&
          record.scope.userId === input.binding.userId,
      );
      if (existing?.decisionStatus === "waiting") {
        return {
          kind: "reused" as const,
          record: existing,
          waitIds: waitIdsFor(map, input.binding.sessionKey),
        };
      }
      if (existing) {
        return {
          kind: "historical" as const,
          record: existing,
          waitIds: waitIdsFor(map, input.binding.sessionKey),
        };
      }
      const decisionId = `ogd_${crypto.randomUUID()}`;
      const resumeRef = `ogr_${crypto.randomUUID()}`;
      const record: OguiDecisionRecord = {
        decisionId,
        version: 1,
        decisionStatus: "waiting",
        resumeStatus: "pending",
        resumeRef,
        scope: {
          sessionKey: input.binding.sessionKey,
          userId: input.binding.userId,
          originRunId: input.binding.originRunId,
          ...(input.binding.taskContextId ? { taskContextId: input.binding.taskContextId } : {}),
          ...(input.binding.originUserMessageRef
            ? { originUserMessageRef: input.binding.originUserMessageRef }
            : {}),
        },
        prompt: parsed.form.prompt,
        proposalKey: parsed.form.proposalKey,
        options: parsed.form.options,
        allowCustom: true,
        multiSelect: false,
        issuedAtMs: now,
        updatedAtMs: now,
      };
      map[decisionId] = record;
      entry.oguiDecisions = map;
      entry.updatedAt = now;
      store[input.binding.sessionKey] = entry;
      return {
        kind: "issued" as const,
        record,
        waitIds: waitIdsFor(map, input.binding.sessionKey),
      };
    });
    if (stored.kind === "failed") {
      replaceOguiSessionWaits(input.binding.sessionKey, stored.waitIds);
      return { kind: "failed", reason: stored.reason, endTurn: true };
    }
    replaceOguiSessionWaits(input.binding.sessionKey, stored.waitIds);
    if (stored.kind === "historical") {
      return {
        kind: "historical",
        decisionId: stored.record.decisionId,
        version: stored.record.version,
        resumeRef: stored.record.resumeRef,
        record: stored.record,
        endTurn: true,
      };
    }
    return {
      kind: "issued",
      decisionId: stored.record.decisionId,
      version: stored.record.version,
      resumeRef: stored.record.resumeRef,
      record: stored.record,
      endTurn: true,
      reason: stored.kind === "reused" ? "reused" : undefined,
    };
  } catch (err) {
    return {
      kind: "failed",
      reason: err instanceof Error ? err.message : "persist_failed",
      endTurn: true,
    };
  }
}

export async function applyOguiDecisionToVisibleText(input: {
  text: string;
  binding: OguiDecisionRunBinding;
  nowMs?: number;
  env?: Record<string, string | undefined>;
  updateStore?: SessionStoreUpdater;
}): Promise<{ text: string; oguiWaitActive: boolean }> {
  const enabled = lifecycleOn({ ...input.binding, env: input.env });
  if (!enabled) {
    replaceOguiSessionWaits(input.binding.sessionKey, []);
    return { text: input.text, oguiWaitActive: false };
  }
  let outcome: OguiIssueOutcome = { kind: "not_proposal" };
  if (input.binding.allowIssue) {
    outcome = await issueOguiDecisionFromText(input);
  }
  const text = applyOguiPromiseCardGate(input.text, outcome);
  let oguiWaitActive = outcome.kind === "issued" || outcome.kind === "failed";
  try {
    const map = loadMap(input.binding.storePath, input.binding.sessionKey);
    if (map) {
      const ids = waitIdsFor(map, input.binding.sessionKey);
      replaceOguiSessionWaits(input.binding.sessionKey, ids);
      oguiWaitActive = ids.length > 0 || outcome.kind === "failed";
    } else {
      oguiWaitActive = true;
    }
  } catch {
    oguiWaitActive = true;
  }
  return { text, oguiWaitActive };
}

export type OguiWaitInboundClass =
  | "proceed"
  | "pause"
  | "answer"
  | "legacy_while_waiting"
  | "reject_answer"
  | "cancel"
  | "replace"
  | "new_goal"
  | "status"
  | "reset";

function hasPhrase(text: string, phrases: readonly string[]): boolean {
  const folded = text.toLowerCase();
  return phrases.some((phrase) => folded.includes(phrase.toLowerCase()));
}

function isCancelText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "取消" || trimmed.toLowerCase() === "cancel") {
    return true;
  }
  return hasPhrase(trimmed, ["取消决策", "取消这个决策", "不用选了", "cancel decision"]);
}

export function classifyOguiWaitInbound(input: {
  inboundText: string;
  hasActiveWait: boolean;
  ingress: OguiDecisionIngress;
}): OguiWaitInboundClass {
  const text = input.inboundText ?? "";
  const answerMatch = ANSWER_RE.exec(text);
  if (answerMatch?.[1]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(answerMatch[1]) as unknown;
    } catch {
      parsed = undefined;
    }
    if (!isPlain(parsed) || oguiAnswerHasUntrustedIdentity(parsed)) {
      return "reject_answer";
    }
    const classified = classifyOguiAnswerDecisionFields(parsed);
    if (classified.kind === "reject") {
      return "reject_answer";
    }
    if (classified.kind === "lifecycle") {
      return "answer";
    }
    if (input.hasActiveWait) {
      return "legacy_while_waiting";
    }
    return "proceed";
  }
  if (input.ingress === "reset") {
    return "reset";
  }
  if (!input.hasActiveWait) {
    return "proceed";
  }
  if (hasPhrase(text, ["新目标", "开始新目标", "换个目标", "开始新任务", "new goal"])) {
    return "new_goal";
  }
  if (hasPhrase(text, ["修改决策", "替换决策", "换一个决策", "replace decision"])) {
    return "replace";
  }
  if (isCancelText(text)) {
    return "cancel";
  }
  if (hasPhrase(text, ["查看决策状态", "决策状态", "查看状态", "decision status"])) {
    return "status";
  }
  if (
    input.ingress === "heartbeat" ||
    input.ingress === "queue" ||
    input.ingress === "retry" ||
    input.ingress === "memory" ||
    input.ingress === "command" ||
    input.ingress === "chat"
  ) {
    return "pause";
  }
  return "pause";
}

function statusText(records: OguiDecisionRecord[]): string {
  const lines = records.map(
    (record) => `- ${record.decisionId} v${record.version} ${record.prompt}`,
  );
  return `等待中的决策（只读）：\n${lines.join("\n")}`;
}

async function supersedeWaiting(input: {
  storePath: string;
  sessionKey: string;
  userId?: string;
  anyUser: boolean;
  nowMs?: number;
  updateStore?: SessionStoreUpdater;
}): Promise<string[]> {
  const plan = planOguiDecisionMutation({ kind: "supersede", lifecycleEnabled: true });
  if (!plan.ok) {
    return [];
  }
  const now = input.nowMs ?? Date.now();
  const update = input.updateStore ?? updateSessionStore;
  const superseded = await update(input.storePath, (store) => {
    const entry = store[input.sessionKey];
    const map = readMap(entry);
    if (!entry || !map) {
      return [] as string[];
    }
    const ids: string[] = [];
    for (const record of Object.values(map)) {
      if (record.decisionStatus !== "waiting" || record.scope.sessionKey !== input.sessionKey) {
        continue;
      }
      if (!input.anyUser && record.scope.userId !== input.userId) {
        continue;
      }
      record.decisionStatus = "superseded";
      record.updatedAtMs = now;
      delete record.deferral;
      ids.push(record.decisionId);
    }
    if (ids.length > 0) {
      entry.oguiDecisions = map;
      entry.updatedAt = now;
      store[input.sessionKey] = entry;
    }
    return ids;
  });
  publishWaits(input.storePath, input.sessionKey);
  return superseded;
}

export type OguiAdmission = {
  action: "proceed" | "resume" | "pause" | "ack";
  text?: string;
  decisionId?: string;
  resumeRef?: string;
};

function parseAnswerObject(text: string): Record<string, unknown> | undefined {
  const match = ANSWER_RE.exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  try {
    const value = JSON.parse(match[1]) as unknown;
    return isPlain(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function admitOguiDecisionTurn(input: {
  cfg?: OguiDecisionLifecycleConfigSlice;
  env?: Record<string, string | undefined>;
  agentId?: string;
  tenantId?: string;
  storePath?: string;
  sessionKey?: string;
  userId?: string;
  inboundText: string;
  ingress: OguiDecisionIngress;
  resetAuthorized?: boolean;
  /**
   * `gate` blocks non-exits but leaves answer consume to the run that will
   * actually start. `run` consumes and claims before the model starts.
   */
  phase?: "gate" | "run";
  binding?: OguiDecisionRunBinding;
  nowMs?: number;
  updateStore?: SessionStoreUpdater;
}): Promise<OguiAdmission> {
  const cfg = input.cfg ?? input.binding?.cfg;
  const agentId = input.agentId ?? input.binding?.agentId;
  const tenantId = input.tenantId ?? input.binding?.tenantId;
  const storePath = input.storePath ?? input.binding?.storePath;
  const sessionKey = input.sessionKey ?? input.binding?.sessionKey;
  const userId = input.userId ?? input.binding?.userId;
  if (!lifecycleOn({ cfg, env: input.env, agentId, tenantId })) {
    return { action: "proceed" };
  }
  if (!storePath || !sessionKey) {
    return { action: "pause", text: OGUI_WAIT_PAUSE_TEXT };
  }
  let map: OguiDecisionMap | undefined;
  try {
    map = loadMap(storePath, sessionKey);
  } catch {
    return { action: "pause", text: OGUI_WAIT_PAUSE_TEXT };
  }
  if (!map) {
    return { action: "pause", text: OGUI_WAIT_PAUSE_TEXT };
  }
  replaceOguiSessionWaits(sessionKey, waitIdsFor(map, sessionKey));
  const waiting = waitingForSession(map, sessionKey);
  const klass = classifyOguiWaitInbound({
    inboundText: input.inboundText,
    hasActiveWait: waiting.length > 0,
    ingress: input.ingress,
  });
  if (klass === "proceed") {
    return { action: "proceed" };
  }
  if (klass === "pause" || klass === "legacy_while_waiting") {
    return { action: "pause", text: OGUI_WAIT_PAUSE_TEXT };
  }
  if (klass === "reject_answer") {
    return { action: "ack", text: "未签发消费。该答案不能作为普通聊天继续原决策。" };
  }
  if (klass === "status") {
    return { action: "ack", text: statusText(waiting) };
  }
  if (klass === "answer" && input.phase === "gate") {
    return { action: "proceed" };
  }
  if (klass === "reset" || klass === "cancel" || klass === "replace" || klass === "new_goal") {
    const anyUser = klass === "reset" && input.resetAuthorized === true;
    if (!anyUser && !userId) {
      return { action: "pause", text: OGUI_WAIT_PAUSE_TEXT };
    }
    await supersedeWaiting({
      storePath,
      sessionKey,
      userId,
      anyUser,
      nowMs: input.nowMs,
      updateStore: input.updateStore,
    });
    if (klass === "cancel") {
      return { action: "ack", text: "已取消等待中的决策，旧卡不再驱动续跑。" };
    }
    if (klass === "reset") {
      return { action: "proceed" };
    }
    return { action: "proceed" };
  }
  const answer = parseAnswerObject(input.inboundText);
  if (!answer) {
    return { action: "ack", text: "未签发消费。该答案不能作为普通聊天继续原决策。" };
  }
  const consumed = await consumeOguiDecisionAnswer({
    storePath,
    sessionKey,
    userId: userId ?? "",
    answer,
    lifecycleEnabled: true,
    cfg,
    env: input.env,
    agentId,
    tenantId,
    nowMs: input.nowMs,
    updateStore: input.updateStore,
  });
  if (!consumed.ok) {
    return { action: "ack", text: consumed.text };
  }
  if (consumed.resumeStatus === "running" && consumed.decisionId) {
    const continued = await continueRecoveredOguiDecisionResume({
      storePath,
      sessionKey,
      decisionId: consumed.decisionId,
      lifecycleEnabled: true,
      nowMs: input.nowMs,
      updateStore: input.updateStore,
    });
    if (continued.continued && continued.resumeRef) {
      return {
        action: "resume",
        decisionId: consumed.decisionId,
        resumeRef: continued.resumeRef,
      };
    }
  }
  if (!consumed.schedule || !consumed.resumeRef || !consumed.decisionId) {
    return {
      action: "ack",
      text: "该决策已接受，沿用原续跑引用，不会再开一条主线。",
      decisionId: consumed.decisionId,
      resumeRef: consumed.resumeRef,
    };
  }
  const claim = await claimOguiDecisionResume({
    storePath,
    sessionKey,
    decisionId: consumed.decisionId,
    lifecycleEnabled: true,
    nowMs: input.nowMs,
    updateStore: input.updateStore,
  });
  if (!claim.claimed) {
    if (claim.reason === "already_started" && consumed.decisionId) {
      const continued = await continueRecoveredOguiDecisionResume({
        storePath,
        sessionKey,
        decisionId: consumed.decisionId,
        lifecycleEnabled: true,
        nowMs: input.nowMs,
        updateStore: input.updateStore,
      });
      if (continued.continued && continued.resumeRef) {
        return {
          action: "resume",
          decisionId: consumed.decisionId,
          resumeRef: continued.resumeRef,
        };
      }
    }
    return {
      action: "ack",
      text: "该决策已接受，沿用原续跑引用，不会再开一条主线。",
      decisionId: consumed.decisionId,
      resumeRef: claim.resumeRef ?? consumed.resumeRef,
    };
  }
  return {
    action: "resume",
    decisionId: consumed.decisionId,
    resumeRef: claim.resumeRef,
  };
}

export type OguiConsumeResult =
  | {
      ok: true;
      idempotent: boolean;
      schedule: boolean;
      decisionId: string;
      version: number;
      resumeRef: string;
      resumeStatus: OguiResumeStatus;
      answer: OguiDecisionAnswer;
    }
  | { ok: false; reason: string; text: string; resumeRef?: string; decisionId?: string };

/**
 * Option submit must match one stored option. A missing option is not
 * custom. Custom requires `answer_mode: "custom"` and `allowCustom`.
 * Single-select: exactly one non-empty string field.
 */
function pickAnswer(
  record: OguiDecisionRecord,
  answer: unknown,
): { kind: "option" | "custom"; value: string; label?: string } | undefined {
  if (!isPlain(answer)) {
    return undefined;
  }
  const mode = nonEmpty(answer.answer_mode);
  if (mode && mode !== "option" && mode !== "custom") {
    return undefined;
  }
  const answers = answer.answers;
  if (!isPlain(answers)) {
    return undefined;
  }
  const entries = Object.entries(answers);
  if (entries.length !== 1) {
    return undefined;
  }
  const field = entries[0]?.[0];
  const raw = entries[0]?.[1];
  if (!nonEmpty(field) || typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  if (mode === "custom") {
    if (!record.allowCustom) {
      return undefined;
    }
    return { kind: "custom", value };
  }
  const option = record.options.find((item) => item.value === value);
  if (!option) {
    return undefined;
  }
  return { kind: "option", value, label: option.label };
}

function sameStoredAnswer(
  stored: OguiDecisionAnswer,
  next: { kind: string; value: string },
): boolean {
  return stored.kind === next.kind && stored.value === next.value;
}

export async function consumeOguiDecisionAnswer(input: {
  storePath: string;
  sessionKey: string;
  userId: string;
  answer: object;
  lifecycleEnabled: boolean;
  cfg?: OguiDecisionLifecycleConfigSlice;
  env?: Record<string, string | undefined>;
  agentId?: string;
  tenantId?: string;
  nowMs?: number;
  updateStore?: SessionStoreUpdater;
}): Promise<OguiConsumeResult> {
  const enabled =
    input.lifecycleEnabled &&
    lifecycleOn({
      cfg: input.cfg,
      env: input.env,
      agentId: input.agentId,
      tenantId: input.tenantId,
    });
  const plan = planOguiDecisionMutation({ kind: "consume", lifecycleEnabled: enabled });
  if (!plan.ok) {
    return {
      ok: false,
      reason: "flag_off",
      text: "未签发消费。该答案不能作为普通聊天继续原决策。",
    };
  }
  if (oguiAnswerHasUntrustedIdentity(input.answer)) {
    return {
      ok: false,
      reason: "untrusted_identity",
      text: "未签发消费。该答案不能作为普通聊天继续原决策。",
    };
  }
  const classified = classifyOguiAnswerDecisionFields(input.answer);
  if (classified.kind !== "lifecycle") {
    return {
      ok: false,
      reason: classified.kind === "legacy" ? "legacy" : classified.reason,
      text: "未签发消费。该答案不能作为普通聊天继续原决策。",
    };
  }
  const submissionId = nonEmpty((input.answer as { submission_id?: unknown }).submission_id);
  if (!submissionId) {
    return {
      ok: false,
      reason: "missing_submission_id",
      text: "未签发消费。该答案不能作为普通聊天继续原决策。",
    };
  }
  const now = input.nowMs ?? Date.now();
  const update = input.updateStore ?? updateSessionStore;
  const reject = (
    reason: string,
    extra?: { resumeRef?: string; decisionId?: string },
  ): OguiConsumeResult => ({
    ok: false,
    reason,
    text:
      reason === "conflict"
        ? "该决策已有不同答案，本次提交冲突，未覆盖已接受的答案。"
        : "未签发消费。该答案不能作为普通聊天继续原决策。",
    ...extra,
  });
  try {
    const consumed = await update(input.storePath, (store) => {
      const entry = store[input.sessionKey];
      const map = readMap(entry);
      if (!entry || !map) {
        return reject("missing_session");
      }
      const record = map[classified.decisionId];
      if (
        !record ||
        record.scope.sessionKey !== input.sessionKey ||
        record.scope.userId !== input.userId
      ) {
        return reject("unknown_decision");
      }
      if (record.version !== classified.version) {
        return reject("version_mismatch", {
          decisionId: record.decisionId,
          resumeRef: record.resumeRef,
        });
      }
      const recordTask = record.scope.taskContextId;
      const sessionTask = nonEmpty(entry.taskContextId) || undefined;
      if (recordTask && recordTask !== sessionTask) {
        return reject("task_mismatch", {
          decisionId: record.decisionId,
          resumeRef: record.resumeRef,
        });
      }
      if (record.decisionStatus === "expired" || record.decisionStatus === "superseded") {
        return reject("historical", { decisionId: record.decisionId, resumeRef: record.resumeRef });
      }
      const picked = pickAnswer(record, input.answer);
      if (record.answer && record.answer.submissionIds.includes(submissionId)) {
        return {
          ok: true as const,
          idempotent: true,
          schedule: record.resumeStatus === "pending" || record.resumeStatus === "retryable",
          decisionId: record.decisionId,
          version: record.version,
          resumeRef: record.resumeRef,
          resumeStatus: record.resumeStatus,
          answer: record.answer,
        };
      }
      if (record.answer) {
        if (!picked || !sameStoredAnswer(record.answer, picked)) {
          return reject("conflict", { decisionId: record.decisionId, resumeRef: record.resumeRef });
        }
        if (!record.answer.submissionIds.includes(submissionId)) {
          record.answer = {
            ...record.answer,
            submissionIds: [...record.answer.submissionIds, submissionId],
          };
          record.updatedAtMs = now;
          entry.oguiDecisions = map;
          entry.updatedAt = now;
          store[input.sessionKey] = entry;
        }
        return {
          ok: true as const,
          idempotent: true,
          schedule: record.resumeStatus === "pending" || record.resumeStatus === "retryable",
          decisionId: record.decisionId,
          version: record.version,
          resumeRef: record.resumeRef,
          resumeStatus: record.resumeStatus,
          answer: record.answer,
        };
      }
      if (record.decisionStatus !== "waiting" || !picked) {
        return reject(picked ? "not_waiting" : "invalid_answer", {
          decisionId: record.decisionId,
          resumeRef: record.resumeRef,
        });
      }
      const { deferral: _deferral, ...rest } = record;
      const answer: OguiDecisionAnswer = {
        kind: picked.kind,
        value: picked.value,
        submissionIds: [submissionId],
        ...(picked.label ? { label: picked.label } : {}),
      };
      const next: OguiDecisionRecord = {
        ...rest,
        decisionStatus: "answered",
        resumeStatus: record.resumeStatus,
        resumeRef: record.resumeRef,
        answer,
        updatedAtMs: now,
      };
      map[record.decisionId] = next;
      entry.oguiDecisions = map;
      entry.updatedAt = now;
      store[input.sessionKey] = entry;
      return {
        ok: true as const,
        idempotent: false,
        schedule: next.resumeStatus === "pending" || next.resumeStatus === "retryable",
        decisionId: next.decisionId,
        version: next.version,
        resumeRef: next.resumeRef,
        resumeStatus: next.resumeStatus,
        answer,
      };
    });
    publishWaits(input.storePath, input.sessionKey);
    return consumed;
  } catch (err) {
    return reject(err instanceof Error ? err.message : "persist_failed");
  }
}

export async function claimOguiDecisionResume(input: {
  storePath: string;
  sessionKey: string;
  decisionId: string;
  lifecycleEnabled: boolean;
  nowMs?: number;
  updateStore?: SessionStoreUpdater;
}): Promise<{ claimed: boolean; resumeRef?: string; reason?: string }> {
  if (!input.lifecycleEnabled) {
    return { claimed: false, reason: "flag_off" };
  }
  const now = input.nowMs ?? Date.now();
  const update = input.updateStore ?? updateSessionStore;
  return await update(input.storePath, (store) => {
    const entry = store[input.sessionKey];
    const map = readMap(entry);
    const record = map?.[input.decisionId];
    if (!entry || !map || !record || record.scope.sessionKey !== input.sessionKey) {
      return { claimed: false, reason: "missing" };
    }
    if (record.resumeStatus === "running" || record.resumeStatus === "completed") {
      return { claimed: false, resumeRef: record.resumeRef, reason: "already_started" };
    }
    if (record.resumeStatus !== "pending" && record.resumeStatus !== "retryable") {
      return { claimed: false, resumeRef: record.resumeRef, reason: "not_claimable" };
    }
    record.resumeStatus = "running";
    record.resumeOwnerPid = process.pid;
    delete record.resumeExecStartedAtMs;
    record.updatedAtMs = now;
    entry.oguiDecisions = map;
    entry.updatedAt = now;
    store[input.sessionKey] = entry;
    return { claimed: true, resumeRef: record.resumeRef };
  });
}

/** D23: rediscover a resume without minting another decision or resumeRef. */
export function recoverOguiDecisionResume(
  map: OguiDecisionMap,
  sessionKey: string,
): { decisionId: string; resumeRef: string; resumeStatus: OguiResumeStatus } | undefined {
  const candidates = Object.values(map)
    .filter(
      (record) =>
        record.scope.sessionKey === sessionKey &&
        (record.decisionStatus === "answered" || record.decisionStatus === "rejected") &&
        (record.resumeStatus === "pending" ||
          record.resumeStatus === "retryable" ||
          record.resumeStatus === "running"),
    )
    .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
  const found = candidates[0];
  if (!found) {
    return undefined;
  }
  return {
    decisionId: found.decisionId,
    resumeRef: found.resumeRef,
    resumeStatus: found.resumeStatus,
  };
}

function pidAlive(pid: number | undefined): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    return code === "EPERM";
  }
}

type ResumeExecInput = {
  storePath: string;
  sessionKey: string;
  decisionId: string;
  resumeRef: string;
  lifecycleEnabled: boolean;
  nowMs?: number;
  updateStore?: SessionStoreUpdater;
};

/**
 * Production caller of `recoverOguiDecisionResume`.
 * Adopts a running resume only when its owner pid is gone, and keeps the
 * same resumeRef. A live owner stays already_started.
 */
export async function continueRecoveredOguiDecisionResume(
  input: ResumeExecInput,
): Promise<{ continued: boolean; resumeRef?: string; reason?: string }> {
  if (!input.lifecycleEnabled) {
    return { continued: false, reason: "flag_off" };
  }
  const now = input.nowMs ?? Date.now();
  const update = input.updateStore ?? updateSessionStore;
  return await update(input.storePath, (store) => {
    const entry = store[input.sessionKey];
    const map = readMap(entry);
    const record = map?.[input.decisionId];
    if (!entry || !map || !record || record.scope.sessionKey !== input.sessionKey) {
      return { continued: false, reason: "missing" };
    }
    const recovered = recoverOguiDecisionResume(map, input.sessionKey);
    if (
      !recovered ||
      recovered.decisionId !== record.decisionId ||
      recovered.resumeRef !== record.resumeRef
    ) {
      return {
        continued: false,
        resumeRef: record.resumeRef,
        reason: recovered ? "other_resume" : "none",
      };
    }
    if (record.resumeStatus !== "running") {
      return { continued: false, resumeRef: record.resumeRef, reason: record.resumeStatus };
    }
    if (pidAlive(record.resumeOwnerPid)) {
      return { continued: false, resumeRef: record.resumeRef, reason: "already_started" };
    }
    record.resumeOwnerPid = process.pid;
    record.updatedAtMs = now;
    entry.oguiDecisions = map;
    entry.updatedAt = now;
    store[input.sessionKey] = entry;
    return { continued: true, resumeRef: record.resumeRef, reason: "recovered" };
  });
}

async function markOguiDecisionExecStarted(
  input: ResumeExecInput,
): Promise<{ ok: boolean; reason?: string }> {
  if (!input.lifecycleEnabled) {
    return { ok: false, reason: "flag_off" };
  }
  const now = input.nowMs ?? Date.now();
  const update = input.updateStore ?? updateSessionStore;
  return await update(input.storePath, (store) => {
    const entry = store[input.sessionKey];
    const map = readMap(entry);
    const record = map?.[input.decisionId];
    if (!entry || !map || !record || record.resumeRef !== input.resumeRef) {
      return { ok: false, reason: "resume_mismatch" };
    }
    if (record.resumeStatus !== "running") {
      return { ok: false, reason: "not_running" };
    }
    if (
      record.resumeOwnerPid !== undefined &&
      record.resumeOwnerPid !== process.pid &&
      pidAlive(record.resumeOwnerPid)
    ) {
      return { ok: false, reason: "already_started" };
    }
    record.resumeOwnerPid = process.pid;
    record.resumeExecStartedAtMs = now;
    record.updatedAtMs = now;
    entry.oguiDecisions = map;
    entry.updatedAt = now;
    store[input.sessionKey] = entry;
    return { ok: true };
  });
}

/** Running resume finished. decisionStatus stays answered or rejected. */
export async function completeOguiDecisionResume(
  input: ResumeExecInput,
): Promise<{ ok: boolean; reason?: string }> {
  if (!input.lifecycleEnabled) {
    return { ok: false, reason: "flag_off" };
  }
  const now = input.nowMs ?? Date.now();
  const update = input.updateStore ?? updateSessionStore;
  return await update(input.storePath, (store) => {
    const entry = store[input.sessionKey];
    const map = readMap(entry);
    const record = map?.[input.decisionId];
    if (!entry || !map || !record || record.resumeRef !== input.resumeRef) {
      return { ok: false, reason: "resume_mismatch" };
    }
    if (record.resumeStatus === "completed") {
      return { ok: true };
    }
    if (record.resumeStatus !== "running") {
      return { ok: false, reason: "not_running" };
    }
    record.resumeStatus = "completed";
    delete record.resumeOwnerPid;
    delete record.resumeExecStartedAtMs;
    record.updatedAtMs = now;
    entry.oguiDecisions = map;
    entry.updatedAt = now;
    store[input.sessionKey] = entry;
    return { ok: true };
  });
}

/** Exec did not finish and this process is still alive. Leaves the resume claimable. */
export async function releaseOguiDecisionResume(input: ResumeExecInput): Promise<void> {
  if (!input.lifecycleEnabled) {
    return;
  }
  const now = input.nowMs ?? Date.now();
  const update = input.updateStore ?? updateSessionStore;
  await update(input.storePath, (store) => {
    const entry = store[input.sessionKey];
    const map = readMap(entry);
    const record = map?.[input.decisionId];
    if (!entry || !map || !record || record.resumeRef !== input.resumeRef) {
      return;
    }
    if (record.resumeStatus !== "running") {
      return;
    }
    record.resumeStatus = "retryable";
    delete record.resumeOwnerPid;
    delete record.resumeExecStartedAtMs;
    record.updatedAtMs = now;
    entry.oguiDecisions = map;
    entry.updatedAt = now;
    store[input.sessionKey] = entry;
  });
}

/**
 * Mark exec started, run the real reply, then write resume completed.
 * A throw leaves the resume running so the caller can release it, or so a
 * dead process can be recovered. Does not mint a second resumeRef.
 */
export async function runWithOguiDecisionResume<T>(
  input: ResumeExecInput & { run: () => Promise<T> },
): Promise<T> {
  const marked = await markOguiDecisionExecStarted(input);
  if (!marked.ok) {
    throw new Error(`ogui_resume_${marked.reason ?? "not_started"}`);
  }
  const result = await input.run();
  const completed = await completeOguiDecisionResume(input);
  if (!completed.ok) {
    throw new Error(`ogui_resume_${completed.reason ?? "complete_failed"}`);
  }
  return result;
}
