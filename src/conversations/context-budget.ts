/**
 * Context Budget Planner (CL-P2-01).
 * Dynamic allocation from actual model context window — never a fixed 8k default.
 *
 * Priority (plan §3.2 / §7.1):
 * 1. System policy / security / tools / tenant bounds (mandatory)
 * 2. Current user input + attachments (required)
 * 3. Approved task context
 * 4. Recent verbatim turns
 * 5. Runtime compaction summary
 * 6. Governed memory
 * 7. Optional background
 */

export type ContextBudgetConfig = {
  /** Model context window tokens (required — resolve from model catalog). */
  modelContextTokens: number;
  /** Reserve for model output. */
  outputReserveTokens?: number;
  /** Reserve for tool protocol / schemas. */
  toolProtocolReserveTokens?: number;
  /** Tokens already claimed by mandatory policy/system prompts. */
  mandatoryPolicyTokens: number;
  /** Tokens for current user input + attachment context (required). */
  currentInputTokens: number;
  /** Optional approved shared/task context size before cap. */
  approvedTaskContextTokens?: number;
  /** Optional recent turns total before cap. */
  recentTurnsTokens?: number;
  /** Optional runtime compaction summary size. */
  runtimeSummaryTokens?: number;
  /** Optional retrieved memory size before cap. */
  retrievedMemoryTokens?: number;
  /** Share of available input for approved task context (default 0.20). */
  approvedTaskShare?: number;
  /** Share range for recent turns (default 0.25–0.40). */
  recentTurnsShareMin?: number;
  recentTurnsShareMax?: number;
  /** Share for runtime summary (default 0.10–0.20). */
  runtimeSummaryShareMin?: number;
  runtimeSummaryShareMax?: number;
  /** Cap share for memory (default 0.10). */
  memoryShareMax?: number;
};

export type ContextBudgetSlice = {
  kind:
    | "mandatory_policy"
    | "current_input"
    | "approved_task"
    | "recent_turns"
    | "runtime_summary"
    | "retrieved_memory"
    | "output_reserve"
    | "tool_protocol_reserve"
    | "unused_reserve";
  requestedTokens: number;
  allocatedTokens: number;
  truncated: boolean;
  reason?: string;
};

export type ContextBudgetPlan = {
  modelContextTokens: number;
  availableInputBudget: number;
  overflow: boolean;
  overflowReason: string | null;
  slices: ContextBudgetSlice[];
  /** Diagnostic trace for agent runs (no user content). */
  trace: ContextBudgetTrace;
};

export type ContextBudgetTrace = {
  modelContextTokens: number;
  outputReserveTokens: number;
  toolProtocolReserveTokens: number;
  mandatoryPolicyTokens: number;
  currentInputTokens: number;
  availableInputBudget: number;
  recentTurnsAllocated: number;
  runtimeSummaryAllocated: number;
  memoryAllocated: number;
  approvedTaskAllocated: number;
  truncatedKinds: string[];
  overflow: boolean;
  overflowReason: string | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function nonNeg(n: number | undefined, fallback = 0): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

/**
 * Plan token budgets. Throws only on invalid model window.
 * When mandatory + current input exceed available budget → overflow (never silent drop).
 */
export function planContextBudget(config: ContextBudgetConfig): ContextBudgetPlan {
  const modelContextTokens = nonNeg(config.modelContextTokens);
  if (modelContextTokens <= 0) {
    throw new Error("modelContextTokens must be a positive integer");
  }

  const outputReserve = nonNeg(
    config.outputReserveTokens,
    Math.min(4096, Math.floor(modelContextTokens * 0.15)),
  );
  const toolReserve = nonNeg(
    config.toolProtocolReserveTokens,
    Math.min(2048, Math.floor(modelContextTokens * 0.05)),
  );
  const mandatory = nonNeg(config.mandatoryPolicyTokens);
  const currentInput = nonNeg(config.currentInputTokens);

  const availableInputBudget = Math.max(
    0,
    modelContextTokens - outputReserve - toolReserve - mandatory,
  );
  const slices: ContextBudgetSlice[] = [
    {
      kind: "output_reserve",
      requestedTokens: outputReserve,
      allocatedTokens: outputReserve,
      truncated: false,
    },
    {
      kind: "tool_protocol_reserve",
      requestedTokens: toolReserve,
      allocatedTokens: toolReserve,
      truncated: false,
    },
    {
      kind: "mandatory_policy",
      requestedTokens: mandatory,
      allocatedTokens: mandatory,
      truncated: false,
    },
  ];

  // Current input is required — if it does not fit, report overflow (do not drop).
  let overflow = false;
  let overflowReason: string | null = null;
  let currentAllocated = currentInput;
  if (currentInput > availableInputBudget) {
    overflow = true;
    overflowReason = "current_input_exceeds_available_budget";
    currentAllocated = availableInputBudget;
    slices.push({
      kind: "current_input",
      requestedTokens: currentInput,
      allocatedTokens: currentAllocated,
      truncated: true,
      reason: overflowReason,
    });
  } else {
    slices.push({
      kind: "current_input",
      requestedTokens: currentInput,
      allocatedTokens: currentAllocated,
      truncated: false,
    });
  }

  let remaining = Math.max(0, availableInputBudget - currentAllocated);

  const taskShare = clamp(config.approvedTaskShare ?? 0.2, 0, 0.5);
  const recentMin = clamp(config.recentTurnsShareMin ?? 0.25, 0, 0.6);
  const recentMax = clamp(config.recentTurnsShareMax ?? 0.4, recentMin, 0.7);
  const summaryMin = clamp(config.runtimeSummaryShareMin ?? 0.1, 0, 0.4);
  const summaryMax = clamp(config.runtimeSummaryShareMax ?? 0.2, summaryMin, 0.5);
  const memoryMax = clamp(config.memoryShareMax ?? 0.1, 0, 0.3);

  // Base pool for optional categories is remaining after required input.
  const pool = remaining;
  const taskCap = Math.floor(pool * taskShare);
  const recentCap = Math.floor(pool * recentMax);
  const recentFloor = Math.floor(pool * recentMin);
  const summaryCap = Math.floor(pool * summaryMax);
  const summaryFloor = Math.floor(pool * summaryMin);
  const memoryCap = Math.floor(pool * memoryMax);

  const allocateOptional = (
    kind: ContextBudgetSlice["kind"],
    requested: number,
    cap: number,
    floor?: number,
  ): number => {
    const want = nonNeg(requested);
    const hardCap = Math.max(0, Math.min(cap, remaining));
    let alloc = Math.min(want, hardCap);
    // Prefer at least floor when content exists and budget allows.
    if (floor && want > 0 && alloc < floor && remaining >= floor) {
      alloc = Math.min(want, floor, remaining);
    }
    remaining -= alloc;
    slices.push({
      kind,
      requestedTokens: want,
      allocatedTokens: alloc,
      truncated: want > alloc,
      reason: want > alloc ? "budget_cap" : undefined,
    });
    return alloc;
  };

  const approvedTaskAllocated = allocateOptional(
    "approved_task",
    config.approvedTaskContextTokens ?? 0,
    taskCap,
  );
  const recentTurnsAllocated = allocateOptional(
    "recent_turns",
    config.recentTurnsTokens ?? 0,
    recentCap,
    recentFloor,
  );
  const runtimeSummaryAllocated = allocateOptional(
    "runtime_summary",
    config.runtimeSummaryTokens ?? 0,
    summaryCap,
    summaryFloor,
  );
  const memoryAllocated = allocateOptional(
    "retrieved_memory",
    config.retrievedMemoryTokens ?? 0,
    memoryCap,
  );

  if (remaining > 0) {
    slices.push({
      kind: "unused_reserve",
      requestedTokens: remaining,
      allocatedTokens: remaining,
      truncated: false,
      reason: "leftover_for_recent_or_unused",
    });
  }

  // Also overflow if mandatory alone exceeds model window after reserves.
  if (mandatory + outputReserve + toolReserve > modelContextTokens) {
    overflow = true;
    overflowReason = overflowReason ?? "mandatory_policy_exceeds_model_window";
  }

  const truncatedKinds = slices.filter((s) => s.truncated).map((s) => s.kind);

  const trace: ContextBudgetTrace = {
    modelContextTokens,
    outputReserveTokens: outputReserve,
    toolProtocolReserveTokens: toolReserve,
    mandatoryPolicyTokens: mandatory,
    currentInputTokens: currentInput,
    availableInputBudget,
    recentTurnsAllocated,
    runtimeSummaryAllocated,
    memoryAllocated,
    approvedTaskAllocated,
    truncatedKinds,
    overflow,
    overflowReason,
  };

  return {
    modelContextTokens,
    availableInputBudget,
    overflow,
    overflowReason,
    slices,
    trace,
  };
}

/** Estimate tokens from text (rough 4 chars/token heuristic for planner tests). */
export function estimateTokensFromText(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}
