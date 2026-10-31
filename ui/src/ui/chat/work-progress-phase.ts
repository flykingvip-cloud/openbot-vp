/**
 * Ephemeral work-progress labels for a live agent turn.
 *
 * Maps gateway events the control chat already receives onto a single
 * status label. This is not transcript text, not a stored assistant reply,
 * and not progress-ledger / task evidence.
 *
 * 正在整理 is the close-out after tool work, before the reply streams or
 * the turn ends. Compaction can also enter it, but a normal turn never
 * emits compaction — the last tool result is the event that does.
 * Chat final / lifecycle end clears it, the same as the other phases.
 */

export type WorkProgressPhase = "thinking" | "drafting" | "verifying" | "wrapping";

export const WORK_PROGRESS_LABELS: Record<WorkProgressPhase, string> = {
  thinking: "正在思考",
  drafting: "正在起草",
  verifying: "正在验证",
  wrapping: "正在整理",
};

export type WorkProgressState = {
  phase: WorkProgressPhase | null;
  toolsInFlight: number;
};

export type WorkProgressHost = {
  workProgressPhase?: WorkProgressPhase | null;
  workProgressToolsInFlight?: number;
};

export type WorkProgressInput =
  | {
      type: "agent";
      event: { stream?: string; data?: Record<string, unknown> };
      /** Visible reply text already on the live stream, not tool output. */
      hasVisibleText?: boolean;
    }
  | {
      type: "chat";
      state: string;
      hasVisibleText?: boolean;
    }
  /** Local turn open, before the model has streamed text or started a tool. */
  | { type: "turn-start" }
  | { type: "clear" };

export function emptyWorkProgressState(): WorkProgressState {
  return { phase: null, toolsInFlight: 0 };
}

export function labelForWorkProgressPhase(
  phase: WorkProgressPhase | null | undefined,
): string | null {
  if (!phase) {
    return null;
  }
  return WORK_PROGRESS_LABELS[phase] ?? null;
}

function dataPhase(data: Record<string, unknown> | undefined): string {
  return typeof data?.phase === "string" ? data.phase : "";
}

function assistantTextStarted(data: Record<string, unknown> | undefined): boolean {
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  const delta = typeof data?.delta === "string" ? data.delta.trim() : "";
  return Boolean(text || delta);
}

function afterToolsDrained(hasVisibleText: boolean): WorkProgressPhase {
  return hasVisibleText ? "drafting" : "thinking";
}

/**
 * Pure event → phase mapping. Same input state and event always yield the
 * same next state; nothing here advances on a timer.
 */
export function reduceWorkProgress(
  state: WorkProgressState,
  input: WorkProgressInput,
): WorkProgressState {
  if (input.type === "clear") {
    return emptyWorkProgressState();
  }

  if (input.type === "turn-start") {
    return { phase: "thinking", toolsInFlight: 0 };
  }

  if (input.type === "chat") {
    if (input.state === "final" || input.state === "aborted" || input.state === "error") {
      return emptyWorkProgressState();
    }
    if (input.state === "user_echo" || input.state === "status") {
      // Status receipts (e.g. discuss→task) must not clear thinking/tool progress.
      return state;
    }
    if (input.state === "delta") {
      if (!input.hasVisibleText) {
        if (state.phase === null && state.toolsInFlight === 0) {
          return { ...state, phase: "thinking" };
        }
        return state;
      }
      if (state.toolsInFlight > 0) {
        return { ...state, phase: "verifying" };
      }
      return { ...state, phase: "drafting" };
    }
    if (input.state === "thinking") {
      if (state.phase === null || state.phase === "thinking") {
        return { ...state, phase: "thinking" };
      }
      return state;
    }
    return state;
  }

  const data = input.event.data ?? {};
  const stream = input.event.stream ?? "";
  const phase = dataPhase(data);
  const hasVisibleText = input.hasVisibleText === true;

  if (stream === "lifecycle") {
    if (phase === "start") {
      if (state.phase === null || state.phase === "thinking") {
        return { phase: "thinking", toolsInFlight: 0 };
      }
      return state;
    }
    if (phase === "end" || phase === "error" || data.aborted === true) {
      return emptyWorkProgressState();
    }
    return state;
  }

  if (stream === "assistant") {
    if (!assistantTextStarted(data)) {
      return state;
    }
    if (state.toolsInFlight > 0) {
      return { ...state, phase: "verifying" };
    }
    return { ...state, phase: "drafting" };
  }

  if (stream === "tool") {
    if (phase === "start") {
      return { phase: "verifying", toolsInFlight: state.toolsInFlight + 1 };
    }
    if (phase === "update") {
      return {
        phase: "verifying",
        toolsInFlight: state.toolsInFlight > 0 ? state.toolsInFlight : 1,
      };
    }
    if (phase === "result") {
      const toolsInFlight = Math.max(0, state.toolsInFlight - 1);
      if (toolsInFlight > 0) {
        return { phase: "verifying", toolsInFlight };
      }
      // Last in-flight tool finished. Stay on 正在整理 until reply text or
      // a terminal event. A duplicate result must not drop back to thinking.
      if (state.toolsInFlight > 0 || state.phase === "verifying" || state.phase === "wrapping") {
        return { phase: "wrapping", toolsInFlight: 0 };
      }
      return { phase: afterToolsDrained(hasVisibleText), toolsInFlight: 0 };
    }
    return state;
  }

  if (stream === "compaction") {
    if (phase === "start") {
      if (state.toolsInFlight > 0) {
        return { ...state, phase: "verifying" };
      }
      return { ...state, phase: "wrapping" };
    }
    if (phase === "end") {
      if (state.toolsInFlight > 0) {
        return { ...state, phase: "verifying" };
      }
      if (data.willRetry === true) {
        return { phase: afterToolsDrained(hasVisibleText), toolsInFlight: 0 };
      }
      if (hasVisibleText) {
        return { phase: "drafting", toolsInFlight: 0 };
      }
      return { phase: "wrapping", toolsInFlight: 0 };
    }
  }

  return state;
}

export function readWorkProgress(host: WorkProgressHost): WorkProgressState {
  const tools = host.workProgressToolsInFlight;
  return {
    phase: host.workProgressPhase ?? null,
    toolsInFlight: typeof tools === "number" && Number.isFinite(tools) ? tools : 0,
  };
}

/** No-op when the host has no progress field, so unrelated test doubles stay untouched. */
export function applyWorkProgress(host: object, input: WorkProgressInput): void {
  if (!host || typeof host !== "object" || !("workProgressPhase" in host)) {
    return;
  }
  const target = host as WorkProgressHost;
  const next = reduceWorkProgress(readWorkProgress(target), input);
  target.workProgressPhase = next.phase;
  target.workProgressToolsInFlight = next.toolsInFlight;
}

export function clearWorkProgress(host: object): void {
  applyWorkProgress(host, { type: "clear" });
}
