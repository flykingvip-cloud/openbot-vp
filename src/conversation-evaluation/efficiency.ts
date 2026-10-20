import type { ClockSource, EfficiencyValue, FirstVisibleKind } from "./types.js";

export const NON_STREAM_TTFT_ALGORITHM = "non_stream_first_complete_reply.v1";

export type EfficiencyInput = {
  t0: number | null;
  t0Source?: ClockSource;
  endedAt: number | null;
  terminal: boolean;
  phase: "start" | "end" | "error" | null;
  /** Value of modelTtftMs. llmTtftMs is intentionally not an input. */
  modelTtftMs: number | null;
  sawFirstToken: boolean;
  firstVisibleAt: number | null;
  firstVisibleKind: FirstVisibleKind | null;
  sawAssistantText: boolean;
  llmMs: number | null;
  toolSpanCount: number;
  toolMeasuredMs: number | null;
  sawCompile: boolean;
  compileMs: number | null;
};

export type EfficiencyFields = {
  totalMs: number | null;
  modelFirstTokenMs: EfficiencyValue;
  ttftMs: EfficiencyValue;
  firstVisibleKind?: FirstVisibleKind;
  ttftAlgorithm?: string;
  llmMs: number | null;
  toolMs: EfficiencyValue;
  toolMsAlgorithm?: "sum_of_spans.v1";
  compileMs: EfficiencyValue;
  dockerMs: "n/a";
  startupMode: "unknown";
  t0Source?: ClockSource;
};

function nonNegative(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * modelFirstTokenMs is only modelTtftMs.
 * User-visible ttftMs is derived from dispatch (or equivalent) to the first
 * visible fragment and is never a rename of modelTtftMs.
 * dockerMs is always n/a. Cold-start samples are not inputs.
 */
export function deriveEfficiency(input: EfficiencyInput): EfficiencyFields {
  let modelFirstTokenMs: EfficiencyValue;
  if (input.modelTtftMs !== null && input.modelTtftMs >= 0 && Number.isFinite(input.modelTtftMs)) {
    modelFirstTokenMs = input.modelTtftMs;
  } else if (!input.sawFirstToken && (input.terminal || input.sawAssistantText)) {
    modelFirstTokenMs = "n/a";
  } else {
    modelFirstTokenMs = null;
  }

  const failedBeforeVisible = input.phase === "error" && input.firstVisibleAt === null;
  let ttftMs: EfficiencyValue = null;
  let firstVisibleKind: FirstVisibleKind | undefined;
  let ttftAlgorithm: string | undefined;
  if (failedBeforeVisible) {
    ttftMs = "n/a";
  } else if (input.firstVisibleAt !== null && input.t0 !== null) {
    const delta = nonNegative(input.firstVisibleAt - input.t0);
    if (delta === null) {
      ttftMs = null;
    } else {
      ttftMs = delta;
      firstVisibleKind = input.firstVisibleKind ?? "other";
      if (!input.sawFirstToken && firstVisibleKind === "model") {
        ttftAlgorithm = NON_STREAM_TTFT_ALGORITHM;
      }
    }
  } else if (input.terminal) {
    ttftMs = "n/a";
  }

  let totalMs: number | null = null;
  if (input.t0 !== null && input.endedAt !== null) {
    totalMs = nonNegative(input.endedAt - input.t0);
  }

  let toolMs: EfficiencyValue;
  let toolMsAlgorithm: "sum_of_spans.v1" | undefined;
  if (input.toolSpanCount === 0) {
    toolMs = "n/a";
  } else if (input.toolMeasuredMs === null) {
    toolMs = null;
  } else {
    toolMs = input.toolMeasuredMs;
    toolMsAlgorithm = "sum_of_spans.v1";
  }

  const compileMs: EfficiencyValue = input.sawCompile ? input.compileMs : "n/a";

  return {
    totalMs,
    modelFirstTokenMs,
    ttftMs,
    ...(firstVisibleKind && typeof ttftMs === "number" ? { firstVisibleKind } : {}),
    ...(ttftAlgorithm ? { ttftAlgorithm } : {}),
    llmMs: input.llmMs,
    toolMs,
    ...(toolMsAlgorithm ? { toolMsAlgorithm } : {}),
    compileMs,
    dockerMs: "n/a",
    startupMode: "unknown",
    ...(input.t0Source ? { t0Source: input.t0Source } : {}),
  };
}
