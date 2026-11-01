/**
 * Emit / update human-attention cards into the group public transcript and
 * keep the unified inbox in sync.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  materializeGroupCollaborationWorkspace,
  resolveGroupPublicTranscriptPath,
} from "../collaboration-learning/collaboration-paths.js";
import { appendPersistedAgentMessageToTranscript } from "../server-methods/chat-transcript-inject.js";
import {
  buildHumanAttentionCard,
  formatHumanAttentionMessageText,
  humanAttentionIdempotencyKey,
  type HumanAttentionCard,
} from "./human-attention-card.js";
import {
  upsertHumanAttentionTodo,
  type HumanAttentionTodo,
  type UpsertHumanAttentionTodoInput,
} from "./human-attention-inbox.js";
import type { RuntimeAuthority } from "./runtime-authority.js";

export type EmitHumanAttentionResult =
  | {
      ok: true;
      todo: HumanAttentionTodo;
      card: HumanAttentionCard;
      created: boolean;
      deduped: boolean;
      messageId?: string;
      skippedEmit?: boolean;
      reason?: string;
    }
  | {
      ok: false;
      reason: string;
      message?: string;
      todo?: HumanAttentionTodo;
      card?: HumanAttentionCard;
    };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

async function ensureTranscriptHeader(params: {
  transcriptPath: string;
  sessionId: string;
}): Promise<void> {
  await fsp.mkdir(path.dirname(params.transcriptPath), { recursive: true });
  try {
    const existing = await fsp.readFile(params.transcriptPath, "utf-8");
    if (existing.trim()) {
      return;
    }
  } catch {
    // create below
  }
  const header = JSON.stringify({
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: params.sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  });
  await fsp.writeFile(params.transcriptPath, `${header}\n`, { encoding: "utf-8", mode: 0o600 });
}

function transcriptHasIdempotencyKey(transcriptPath: string, idempotencyKey: string): boolean {
  try {
    const text = fs.readFileSync(transcriptPath, "utf-8");
    if (!text.includes(idempotencyKey)) {
      return false;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const message =
          parsed && typeof parsed.message === "object" && parsed.message
            ? (parsed.message as Record<string, unknown>)
            : parsed;
        if (message && message.idempotencyKey === idempotencyKey) {
          return true;
        }
      } catch {
        // continue
      }
    }
    return false;
  } catch {
    return false;
  }
}

function buildAssistantMessageBody(params: {
  card: HumanAttentionCard;
  text: string;
  nowMs: number;
  idempotencyKey: string;
}): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text: params.text }],
    timestamp: params.nowMs,
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    api: "openai-responses",
    provider: "openclaw",
    model: "gateway-injected",
    idempotencyKey: params.idempotencyKey,
    humanAttention: params.card,
  };
}

function cardFromTodo(todo: HumanAttentionTodo): HumanAttentionCard | null {
  return buildHumanAttentionCard({
    todoId: todo.id,
    groupId: todo.groupId,
    taskId: todo.taskId,
    boardItemId: todo.itemId,
    fingerprint: todo.fingerprint,
    version: todo.version,
    failureKind: todo.failureKind,
    reason: todo.reason,
    ownerIds: todo.ownerIds,
    recoveryHint: todo.recoveryHint,
    taskTitle: todo.taskTitle,
    boardStatus: todo.boardStatus,
    resolution: todo.resolution,
  });
}

/**
 * Upsert inbox (dedupe) + emit conversation card for active todos.
 * Same todoId+version is idempotent in the transcript.
 */
export async function openHumanAttentionWithCard(
  params: UpsertHumanAttentionTodoInput & {
    cfg?: OpenBotConfig;
    authority?: RuntimeAuthority | null;
    emitCard?: boolean;
  },
): Promise<EmitHumanAttentionResult> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  let upserted: ReturnType<typeof upsertHumanAttentionTodo>;
  try {
    upserted = upsertHumanAttentionTodo({ ...params, nowMs });
  } catch (error) {
    return {
      ok: false,
      reason: "upsert_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const { todo, created, deduped } = upserted;
  const card = cardFromTodo(todo);
  if (!card) {
    return { ok: false, reason: "card_build_failed", todo };
  }
  if (params.emitCard === false) {
    return { ok: true, todo, card, created, deduped, skippedEmit: true, reason: "emit_disabled" };
  }

  const groupId = compact(todo.groupId);
  try {
    await materializeGroupCollaborationWorkspace(groupId, cfg);
  } catch {
    // mkdir on transcript write may still succeed
  }
  const transcriptPath = resolveGroupPublicTranscriptPath(groupId, cfg);
  const sessionId = `group-${groupId}`;
  try {
    await ensureTranscriptHeader({ transcriptPath, sessionId });
  } catch (err) {
    return {
      ok: false,
      reason: "transcript_header",
      message: err instanceof Error ? err.message : String(err),
      todo,
      card,
    };
  }

  const idempotencyKey = humanAttentionIdempotencyKey(card);
  if (transcriptHasIdempotencyKey(transcriptPath, idempotencyKey)) {
    return {
      ok: true,
      todo,
      card,
      created,
      deduped,
      skippedEmit: true,
      reason: "idempotent_exists",
    };
  }

  const text = formatHumanAttentionMessageText(card, { includeFence: true });
  const messageBody = buildAssistantMessageBody({
    card,
    text,
    nowMs,
    idempotencyKey,
  });
  const appended = appendPersistedAgentMessageToTranscript({
    transcriptPath,
    message: messageBody,
  });
  if (!appended.ok) {
    return {
      ok: false,
      reason: "transcript_append",
      message: appended.error ?? "failed to append human attention card",
      todo,
      card,
    };
  }
  return {
    ok: true,
    todo,
    card,
    created,
    deduped,
    messageId: appended.messageId,
  };
}

/** Emit a resolution receipt card after an action closes/updates the todo. */
export async function emitHumanAttentionResolutionReceipt(params: {
  todo: HumanAttentionTodo;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<EmitHumanAttentionResult> {
  const cfg = params.cfg ?? loadConfig();
  const nowMs = params.nowMs ?? Date.now();
  const card = cardFromTodo(params.todo);
  if (!card || !params.todo.resolution) {
    return { ok: false, reason: "card_build_failed", todo: params.todo };
  }
  const groupId = compact(params.todo.groupId);
  try {
    await materializeGroupCollaborationWorkspace(groupId, cfg);
  } catch {
    // continue
  }
  const transcriptPath = resolveGroupPublicTranscriptPath(groupId, cfg);
  try {
    await ensureTranscriptHeader({ transcriptPath, sessionId: `group-${groupId}` });
  } catch (err) {
    return {
      ok: false,
      reason: "transcript_header",
      message: err instanceof Error ? err.message : String(err),
      todo: params.todo,
      card,
    };
  }
  const idempotencyKey = `${humanAttentionIdempotencyKey(card)}:resolved:${params.todo.resolution.action}:${params.todo.resolution.at}`;
  if (transcriptHasIdempotencyKey(transcriptPath, idempotencyKey)) {
    return {
      ok: true,
      todo: params.todo,
      card,
      created: false,
      deduped: true,
      skippedEmit: true,
      reason: "idempotent_exists",
    };
  }
  const text = formatHumanAttentionMessageText(card, { includeFence: true });
  const appended = appendPersistedAgentMessageToTranscript({
    transcriptPath,
    message: buildAssistantMessageBody({ card, text, nowMs, idempotencyKey }),
  });
  if (!appended.ok) {
    return {
      ok: false,
      reason: "transcript_append",
      message: appended.error ?? "failed to append resolution receipt",
      todo: params.todo,
      card,
    };
  }
  return {
    ok: true,
    todo: params.todo,
    card,
    created: false,
    deduped: false,
    messageId: appended.messageId,
  };
}
