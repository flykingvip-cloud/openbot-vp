import fs from "node:fs";
import path from "node:path";
import {
  CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
  INTERACTION_MODEL_FAILURE_TEXT,
  INTERACTION_RECORD_UNAVAILABLE_TEXT,
  INTERACTION_TIMEOUT_TEXT,
  classifyInteractionFailure,
} from "../agent-runtime/model/interaction-resource-wait.js";
import { CONFIG_DIR } from "../utils.js";

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

export function resolveChatTurnTerminalDir(storeDir?: string): string {
  return storeDir?.trim() || path.join(CONFIG_DIR, "openbot-chat-turn-terminals");
}

export function chatTurnTerminalPath(runId: string, storeDir?: string, sessionKey?: string): string {
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
  const dir = path.join(resolveChatTurnTerminalDir(storeDir), encodeURIComponent(sessionKey.trim() || "_"));
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as ChatTurnTerminalReceipt;
          return parsed?.runId ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export function writeChatTurnTerminal(
  receipt: ChatTurnTerminalReceipt,
  storeDir?: string,
): boolean {
  try {
    const dest = chatTurnTerminalPath(receipt.runId, storeDir, receipt.sessionKey);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(receipt)}\n`, { encoding: "utf8" });
    fs.renameSync(tmp, dest);
    return true;
  } catch {
    return false;
  }
}

export async function reconcileChatTurnTerminal(params: {
  runId: string;
  storeDir?: string;
  sessionKey?: string;
  append: (message: string, idempotencyKey: string) => Promise<{ ok: boolean }>;
}): Promise<{ reconciled: boolean; receipt?: ChatTurnTerminalReceipt }> {
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
    writeChatTurnTerminal(next, params.storeDir);
    return { reconciled: true, receipt: next };
  } catch {
    return { reconciled: false, receipt };
  }
}

function isInterpretationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const phase = (error as { interactionPhase?: string }).interactionPhase;
  if (phase === "interpretation") {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  if (INTERACTION_DECISION_PATTERN.test(message)) {
    return true;
  }
  const kind = classifyInteractionFailure(error);
  return kind === "timeout" || kind === "empty" || kind === "queue_timeout";
}

function isGovernedBillingInterpretation(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "FailoverError" &&
    (error as Error & { reason?: string }).reason === "billing" &&
    (error as Error & { interactionPhase?: string }).interactionPhase === "interpretation"
  );
}

export function formatChatTurnTerminalText(error: unknown): { text: string; businessExecution: "none" | "unknown" } {
  if (isGovernedBillingInterpretation(error)) {
    return { text: BILLING_BLOCKED_INTERACTION_TEXT, businessExecution: "none" };
  }
  if (isInterpretationFailure(error)) {
    const kind = classifyInteractionFailure(error);
    if (kind === "timeout" || kind === "empty") {
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
        : params.error instanceof Error
          ? params.error.message
          : "interaction_failure",
      shape: (params.error as Error & { shape?: unknown }).shape,
      stack: params.error instanceof Error ? params.error.stack?.split("\n").slice(1, 7) : undefined,
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
    at: new Date().toISOString(),
  };
  const stored = writeChatTurnTerminal(receipt, params.storeDir);
  if (persisted) {
    return { persisted: true, text: params.text };
  }
  return {
    persisted: false,
    text: receipt.text,
    recordTemporarilyUnavailable: true,
    ...(stored ? {} : {}),
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
  return params.persisted ? params.fallback : `${params.fallback}\n\n${INTERACTION_RECORD_UNAVAILABLE_TEXT}`;
}
