import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
  INTERACTION_MODEL_FAILURE_TEXT,
  INTERACTION_RECORD_UNAVAILABLE_TEXT,
  INTERACTION_TIMEOUT_TEXT,
  classifyInteractionFailure,
} from "../agent-runtime/model/index.js";
import { formatInteractionFailureReply } from "../agent-runtime/model/interaction-resource-wait.js";
import { SESSION_TASK_BOARD_LOCK_OPTIONS, withFileLock } from "../infra/file-lock.js";
import { createAsyncLock } from "../infra/json-files.js";
import { resolveConfigDir } from "../utils.js";

export const REJECTED_INTERACTION_TURN_TEXT =
  "本轮未形成可执行的决定，没有启动新任务。本轮请求已结束，不会自动补做；如需重试，请明确提出。";
export const BILLING_BLOCKED_INTERACTION_TEXT =
  "模型服务余额不足，本轮未能生成回复或启动新任务。请联系管理员恢复模型额度后再试。";

export type ChatTurnTerminalReceipt = {
  runId: string;
  sessionKey?: string;
  text: string;
  persistedToTranscript: boolean;
  /** none = interaction failed before admission; unknown = later error, do not claim no execution. */
  businessExecution: "none" | "unknown";
  recordTemporarilyUnavailable: boolean;
  at: string;
};

const INTERACTION_DECISION_PATTERN =
  /^(?:Invalid interaction (?:decision|reply|answer|target|task decision|acceptance checks)|Interaction target is not bound to this request|Interaction did not return a final decision|本轮未取得有效的交互决定，没有启动或修改任务。)$/;

/** Short, non-reversible run identifier for gateway warn lines. */
export function shortChatRunId(runId: string): string {
  return createHash("sha256").update(runId).digest("hex").slice(0, 12);
}

function describeInteractionFailureForLog(error: unknown, runId?: string): Record<string, unknown> {
  const errorClass = error instanceof Error ? error.name : typeof error;
  const phase =
    error && typeof error === "object" && "interactionPhase" in error
      ? String((error as { interactionPhase?: unknown }).interactionPhase)
      : undefined;
  const reason =
    error && typeof error === "object" && "reason" in error
      ? String((error as { reason?: unknown }).reason)
      : undefined;
  const usageRecorded =
    error &&
    typeof error === "object" &&
    (error as { usageRecorded?: unknown }).usageRecorded === true;
  const shape =
    error && typeof error === "object" ? (error as { shape?: unknown }).shape : undefined;
  return {
    errorClass,
    ...(runId ? { run: shortChatRunId(runId) } : {}),
    ...(phase ? { phase } : {}),
    ...(reason && reason.length < 40 && !reason.includes("{") ? { reason } : {}),
    kind: classifyInteractionFailure(error),
    ...(usageRecorded ? { usageRecorded: true } : {}),
    ...(shape && typeof shape === "object" && shape ? { shape } : {}),
  };
}

export function resolveChatTurnTerminalDir(storeDir?: string): string {
  return storeDir?.trim() || path.join(resolveConfigDir(), "openbot-chat-turn-terminals");
}

export function chatTurnTerminalPath(
  runId: string,
  storeDir?: string,
  sessionKey?: string,
): string {
  return path.join(
    resolveChatTurnTerminalDir(storeDir),
    encodeURIComponent(sessionKey?.trim() || "_"),
    `${encodeURIComponent(runId)}.json`,
  );
}

export function readChatTurnTerminal(
  runId: string,
  storeDir?: string,
  sessionKey?: string,
): ChatTurnTerminalReceipt | undefined {
  try {
    const raw = fs.readFileSync(chatTurnTerminalPath(runId, storeDir, sessionKey), "utf8");
    const parsed = JSON.parse(raw) as ChatTurnTerminalReceipt;
    return parsed?.runId === runId ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function listChatTurnTerminals(
  sessionKey: string,
  storeDir?: string,
): ChatTurnTerminalReceipt[] {
  const dir = path.join(
    resolveChatTurnTerminalDir(storeDir),
    encodeURIComponent(sessionKey.trim() || "_"),
  );
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        try {
          const parsed = JSON.parse(
            fs.readFileSync(path.join(dir, name), "utf8"),
          ) as ChatTurnTerminalReceipt;
          return parsed?.runId ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function terminalFactKey(text: string): string {
  const suffix = `\n\n${INTERACTION_RECORD_UNAVAILABLE_TEXT}`;
  return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}

function canUpgradeChatTurnTerminal(
  existing: ChatTurnTerminalReceipt,
  next: ChatTurnTerminalReceipt,
): boolean {
  if (existing.runId !== next.runId) {
    return false;
  }
  if (
    existing.businessExecution !== next.businessExecution ||
    terminalFactKey(existing.text) !== terminalFactKey(next.text)
  ) {
    return false;
  }
  // Same fact may upgrade from not-persisted to persisted, but must not
  // downgrade a durable settlement or replace an opposite fact.
  if (existing.persistedToTranscript && !next.persistedToTranscript) {
    return false;
  }
  return true;
}

function writeChatTurnTerminalRecord(receipt: ChatTurnTerminalReceipt, storeDir?: string): boolean {
  try {
    const dest = chatTurnTerminalPath(receipt.runId, storeDir, receipt.sessionKey);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const existing = readChatTurnTerminal(receipt.runId, storeDir, receipt.sessionKey);
    if (existing && !canUpgradeChatTurnTerminal(existing, receipt)) {
      return false;
    }
    const tmp = `${dest}.${process.pid}.${Date.now().toString(16)}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(receipt)}\n`, { encoding: "utf8" });
    try {
      if (!existing) {
        try {
          fs.linkSync(tmp, dest);
          fs.rmSync(tmp, { force: true });
          return true;
        } catch (err) {
          if ((err as { code?: string }).code !== "EEXIST") {
            throw err;
          }
          const raced = readChatTurnTerminal(receipt.runId, storeDir, receipt.sessionKey);
          if (!raced || !canUpgradeChatTurnTerminal(raced, receipt)) {
            fs.rmSync(tmp, { force: true });
            return false;
          }
        }
      }
      const current = readChatTurnTerminal(receipt.runId, storeDir, receipt.sessionKey);
      if (current && !canUpgradeChatTurnTerminal(current, receipt)) {
        fs.rmSync(tmp, { force: true });
        return false;
      }
      fs.renameSync(tmp, dest);
      return true;
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  } catch {
    return false;
  }
}

export function writeChatTurnTerminal(
  receipt: ChatTurnTerminalReceipt,
  storeDir?: string,
): boolean {
  return writeChatTurnTerminalRecord(receipt, storeDir);
}

const chatTurnTerminalPathLocks = new Map<string, ReturnType<typeof createAsyncLock>>();

function resolveChatTurnTerminalLockPath(
  runId: string,
  storeDir?: string,
  sessionKey?: string,
): string {
  return path.resolve(chatTurnTerminalPath(runId, storeDir, sessionKey));
}

function lockForChatTurnTerminalPath(dest: string): ReturnType<typeof createAsyncLock> {
  const existing = chatTurnTerminalPathLocks.get(dest);
  if (existing) {
    return existing;
  }
  const created = createAsyncLock();
  chatTurnTerminalPathLocks.set(dest, created);
  return created;
}

async function withChatTurnTerminalLock<T>(
  params: { runId: string; storeDir?: string; sessionKey?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const dest = resolveChatTurnTerminalLockPath(params.runId, params.storeDir, params.sessionKey);
  // In-process path lock first: withFileLock reenters when the same process
  // already holds the path, which lets a second independent request read an
  // unsealed receipt during the first append. Persist and reconcile share this
  // resolved-path identity. createAsyncLock is not reentrant; callers of this
  // helper do not nest on the same path.
  return lockForChatTurnTerminalPath(dest)(() =>
    withFileLock(dest, SESSION_TASK_BOARD_LOCK_OPTIONS, fn),
  );
}

export async function reconcileChatTurnTerminal(params: {
  runId: string;
  storeDir?: string;
  sessionKey?: string;
  append: (message: string, idempotencyKey: string) => Promise<{ ok: boolean }>;
}): Promise<{ reconciled: boolean; receipt?: ChatTurnTerminalReceipt }> {
  return withChatTurnTerminalLock(params, async () => {
    const receipt = readChatTurnTerminal(params.runId, params.storeDir, params.sessionKey);
    if (!receipt || receipt.persistedToTranscript) {
      return { reconciled: false, ...(receipt ? { receipt } : {}) };
    }
    try {
      const result = await params.append(receipt.text, `${params.runId}:interaction-rejected`);
      if (!result.ok) {
        return { reconciled: false, receipt };
      }
      const next = {
        ...receipt,
        persistedToTranscript: true,
        recordTemporarilyUnavailable: false,
      };
      writeChatTurnTerminalRecord(next, params.storeDir);
      return { reconciled: true, receipt: next };
    } catch {
      return { reconciled: false, receipt };
    }
  });
}

function isInterpretationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const phase = (error as { interactionPhase?: string }).interactionPhase;
  // Trusted host phase is the admission fact. Do not infer "never executed"
  // from timeout keywords once execution may have started, or when the
  // phase is absent.
  if (phase === "execution") {
    return false;
  }
  if (phase === "interpretation") {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  if (INTERACTION_DECISION_PATTERN.test(message)) {
    return true;
  }
  // Broken protocol JSON must not be inferred as an execution-phase error.
  if (error instanceof SyntaxError) {
    return true;
  }
  const kind = classifyInteractionFailure(error);
  return kind === "queue_timeout";
}

function isGovernedBillingInterpretation(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "FailoverError" &&
    (error as Error & { reason?: string }).reason === "billing" &&
    (error as Error & { interactionPhase?: string }).interactionPhase === "interpretation"
  );
}

export function formatChatTurnTerminalText(error: unknown): {
  text: string;
  businessExecution: "none" | "unknown";
} {
  if (isGovernedBillingInterpretation(error)) {
    return { text: BILLING_BLOCKED_INTERACTION_TEXT, businessExecution: "none" };
  }
  if (isInterpretationFailure(error)) {
    if (error instanceof SyntaxError) {
      return { text: REJECTED_INTERACTION_TURN_TEXT, businessExecution: "none" };
    }
    const kind = classifyInteractionFailure(error);
    if (kind === "empty") {
      return { text: formatInteractionFailureReply(error), businessExecution: "none" };
    }
    if (kind === "timeout") {
      return { text: INTERACTION_TIMEOUT_TEXT, businessExecution: "none" };
    }
    if (kind === "model") {
      return { text: INTERACTION_MODEL_FAILURE_TEXT, businessExecution: "none" };
    }
    if (kind === "queue_timeout") {
      const message = error instanceof Error ? error.message.trim() : "";
      return { text: message || INTERACTION_TIMEOUT_TEXT, businessExecution: "none" };
    }
    return { text: REJECTED_INTERACTION_TURN_TEXT, businessExecution: "none" };
  }
  return { text: CHAT_TURN_ERROR_UNCONFIRMED_TEXT, businessExecution: "unknown" };
}

/** Only pre-admission failures may attest that no new task started. */
export async function persistRejectedInteractionTurn(params: {
  error: unknown;
  runId: string;
  append: (message: string, idempotencyKey: string) => Promise<{ ok: boolean }>;
  sessionKey?: string;
  storeDir?: string;
}): Promise<{ persisted: boolean; text?: string; recordTemporarilyUnavailable?: boolean }> {
  if (!isGovernedBillingInterpretation(params.error) && !isInterpretationFailure(params.error)) {
    return persistGeneralChatTurnTerminal(params);
  }
  const { text, businessExecution } = formatChatTurnTerminalText(params.error);
  console.warn(
    "[interaction-rejection-source]",
    JSON.stringify({
      validation: isGovernedBillingInterpretation(params.error)
        ? "interaction_provider_billing"
        : "interaction_failure",
      ...describeInteractionFailureForLog(params.error, params.runId),
    }),
  );
  return writeTerminalWithTranscript({
    ...params,
    text,
    businessExecution,
  });
}

/** Durable, queryable receipt for broadcast errors. Does not invent an event bus. */
export async function persistGeneralChatTurnTerminal(params: {
  error: unknown;
  runId: string;
  append: (message: string, idempotencyKey: string) => Promise<{ ok: boolean }>;
  sessionKey?: string;
  storeDir?: string;
}): Promise<{ persisted: boolean; text?: string; recordTemporarilyUnavailable?: boolean }> {
  const { text, businessExecution } = formatChatTurnTerminalText(params.error);
  return writeTerminalWithTranscript({
    ...params,
    text,
    businessExecution,
  });
}

async function writeTerminalWithTranscript(params: {
  runId: string;
  text: string;
  businessExecution: "none" | "unknown";
  append: (message: string, idempotencyKey: string) => Promise<{ ok: boolean }>;
  sessionKey?: string;
  storeDir?: string;
}): Promise<{ persisted: boolean; text?: string; recordTemporarilyUnavailable?: boolean }> {
  return withChatTurnTerminalLock(params, () => writeTerminalWithTranscriptLocked(params));
}

async function writeTerminalWithTranscriptLocked(params: {
  runId: string;
  text: string;
  businessExecution: "none" | "unknown";
  append: (message: string, idempotencyKey: string) => Promise<{ ok: boolean }>;
  sessionKey?: string;
  storeDir?: string;
}): Promise<{ persisted: boolean; text?: string; recordTemporarilyUnavailable?: boolean }> {
  const existing = readChatTurnTerminal(params.runId, params.storeDir, params.sessionKey);
  if (
    existing &&
    (existing.businessExecution !== params.businessExecution ||
      terminalFactKey(existing.text) !== terminalFactKey(params.text))
  ) {
    // Same request already has a sealed fact. A late model result must not
    // create a conflicting terminal or start another append.
    return {
      persisted: existing.persistedToTranscript,
      text: existing.text,
      ...(existing.recordTemporarilyUnavailable ? { recordTemporarilyUnavailable: true } : {}),
    };
  }
  if (existing?.persistedToTranscript) {
    return { persisted: true, text: terminalFactKey(existing.text) };
  }
  let persisted = false;
  try {
    const result = await params.append(params.text, `${params.runId}:interaction-rejected`);
    persisted = result.ok;
  } catch {
    persisted = false;
  }
  const receipt: ChatTurnTerminalReceipt = {
    runId: params.runId,
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    text: persisted ? params.text : `${params.text}\n\n${INTERACTION_RECORD_UNAVAILABLE_TEXT}`,
    persistedToTranscript: persisted,
    businessExecution: params.businessExecution,
    recordTemporarilyUnavailable: !persisted,
    at: existing?.at ?? new Date().toISOString(),
  };
  writeChatTurnTerminalRecord(receipt, params.storeDir);
  if (persisted) {
    return { persisted: true, text: params.text };
  }
  return {
    persisted: false,
    text: receipt.text,
    recordTemporarilyUnavailable: true,
  };
}

export function visibleTerminalText(params: {
  persisted: boolean;
  text?: string;
  fallback: string;
}): string {
  if (params.text) {
    return params.text;
  }
  return params.persisted
    ? params.fallback
    : `${params.fallback}\n\n${INTERACTION_RECORD_UNAVAILABLE_TEXT}`;
}
