import type { ThinkingProgressSnapshot } from "../../../../src/shared/text/thinking-progress.ts";
import type { WorkProgressPhase } from "../chat/work-progress-phase.ts";

/**
 * Socket dropped after the frame was written. The gateway may already have
 * accepted the idempotency key, so the optimistic row must stay until
 * `chat.history` says the session is idle.
 */
export function isGatewaySocketClosedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /gateway closed\s*\(/i.test(message);
}

export type HistoryActiveRun = {
  runId: string;
  text: string;
};

export type HistoryOccupancySnapshot = {
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatStreamSessionKey: string | null;
  chatThinkingProgress: ThinkingProgressSnapshot | null;
  workProgressPhase: WorkProgressPhase | null;
  workProgressToolsInFlight: number;
  workProgressNarration: string | null;
};

export type HistoryOccupancyHost = {
  chatSending?: boolean;
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatStreamSessionKey: string | null;
  chatThinkingProgress: ThinkingProgressSnapshot | null;
  workProgressPhase?: WorkProgressPhase | null;
  workProgressToolsInFlight?: number;
  workProgressNarration?: string | null;
};

/** `undefined` means an older gateway that does not report occupancy. */
export function readHistoryActiveRun(value: unknown): HistoryActiveRun | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const runId = (value as { runId?: unknown }).runId;
  if (typeof runId !== "string" || !runId.trim()) {
    return null;
  }
  const text = (value as { text?: unknown }).text;
  return {
    runId: runId.trim(),
    text: typeof text === "string" ? text : "",
  };
}

export function preferVisibleChatStream(current: string | null, incoming: string): string {
  const next = incoming;
  const existing = current ?? "";
  if (!existing) {
    return next;
  }
  if (!next) {
    return existing;
  }
  if (next.length >= existing.length || !existing.startsWith(next)) {
    return next;
  }
  return existing;
}

const TERMINAL_CHAT_RUN_LIMIT = 64;
const terminalChatRunIds = new Set<string>();

/**
 * A chat.final / abort / error already ended this run on this client.
 * `chat.history` can still report it until the gateway drops the abort
 * controller, which happens after the final broadcast. That snapshot must
 * not turn the composer back into 正在思考 + Stop. An open computer preview
 * is not a live chat run.
 */
export function noteTerminalChatRun(runId: string | null | undefined): void {
  const id = runId?.trim() ?? "";
  if (!id || terminalChatRunIds.has(id)) {
    return;
  }
  terminalChatRunIds.add(id);
  while (terminalChatRunIds.size > TERMINAL_CHAT_RUN_LIMIT) {
    const oldest = terminalChatRunIds.values().next().value;
    if (!oldest) {
      break;
    }
    terminalChatRunIds.delete(oldest);
  }
}

export function isTerminalChatRun(runId: string | null | undefined): boolean {
  const id = runId?.trim() ?? "";
  if (!id) {
    return false;
  }
  if (terminalChatRunIds.has(id)) {
    return true;
  }
  for (const known of terminalChatRunIds) {
    if (id.startsWith(`${known}:`) || known.startsWith(`${id}:`)) {
      return true;
    }
  }
  return false;
}

export function resetTerminalChatRunsForTests(): void {
  terminalChatRunIds.clear();
}

function sameChatTurnRun(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) {
    return false;
  }
  return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);
}

function clearOccupancy(state: HistoryOccupancyHost) {
  state.chatRunId = null;
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatStreamSessionKey = null;
  state.chatThinkingProgress = null;
  state.workProgressPhase = null;
  state.workProgressToolsInFlight = 0;
  state.workProgressNarration = null;
}

function restorePreserved(state: HistoryOccupancyHost, preserved: HistoryOccupancySnapshot) {
  state.chatRunId = preserved.chatRunId;
  state.chatStream = preserved.chatStream;
  state.chatStreamStartedAt = preserved.chatStreamStartedAt;
  state.chatStreamSessionKey = preserved.chatStreamSessionKey;
  state.chatThinkingProgress = preserved.chatThinkingProgress;
  state.workProgressPhase = preserved.workProgressPhase;
  state.workProgressToolsInFlight = preserved.workProgressToolsInFlight;
  state.workProgressNarration = preserved.workProgressNarration;
}

/**
 * Apply the server's active-run snapshot after history loads.
 * Returns whether the live tool stream should be reset.
 */
export function applyHistoryActiveRunOccupancy(params: {
  state: HistoryOccupancyHost;
  preserved: HistoryOccupancySnapshot | null;
  activeRun: HistoryActiveRun | null | undefined;
  nowMs?: number;
}): "adopt" | "keep" | "clear" {
  const { state, preserved, activeRun } = params;
  const nowMs = params.nowMs ?? Date.now();
  const terminalCleared = preserved != null && state.chatRunId !== preserved.chatRunId;
  const sending = state.chatSending === true;

  if (activeRun && isTerminalChatRun(activeRun.runId)) {
    const localId = state.chatRunId?.trim() ?? "";
    const localIsReplacement =
      Boolean(localId) && !isTerminalChatRun(localId) && !sameChatTurnRun(localId, activeRun.runId);
    if (!localIsReplacement) {
      clearOccupancy(state);
      return "clear";
    }
    return "keep";
  }

  if (activeRun && !(terminalCleared && preserved?.chatRunId === activeRun.runId)) {
    const keepLocal =
      preserved != null &&
      !terminalCleared &&
      (preserved.chatRunId === activeRun.runId || state.chatRunId === activeRun.runId);
    state.chatRunId = activeRun.runId;
    if (keepLocal && preserved) {
      state.chatStream = preferVisibleChatStream(preserved.chatStream, activeRun.text);
      state.chatStreamStartedAt = preserved.chatStreamStartedAt ?? nowMs;
      state.chatStreamSessionKey = preserved.chatStreamSessionKey;
      state.chatThinkingProgress = preserved.chatThinkingProgress;
      state.workProgressPhase = preserved.workProgressPhase;
      state.workProgressToolsInFlight = preserved.workProgressToolsInFlight;
      state.workProgressNarration = preserved.workProgressNarration;
    } else {
      state.chatStream = activeRun.text;
      state.chatStreamStartedAt = state.chatStreamStartedAt ?? nowMs;
      state.chatStreamSessionKey = preserved?.chatStreamSessionKey ?? state.chatStreamSessionKey;
      state.chatThinkingProgress = null;
      state.workProgressPhase = activeRun.text.trim() ? "drafting" : "thinking";
      state.workProgressToolsInFlight = 0;
      state.workProgressNarration = null;
    }
    if (state.chatStream == null) {
      state.chatStream = "";
    }
    return "adopt";
  }

  if (activeRun === null && !sending) {
    // Stick the idle result. A slower snapshot can still name this run until
    // the gateway drops the abort controller.
    noteTerminalChatRun(state.chatRunId);
    noteTerminalChatRun(preserved?.chatRunId ?? null);
    clearOccupancy(state);
    return "clear";
  }

  if (preserved && state.chatRunId === preserved.chatRunId) {
    restorePreserved(state, preserved);
    return "keep";
  }

  clearOccupancy(state);
  return "clear";
}
