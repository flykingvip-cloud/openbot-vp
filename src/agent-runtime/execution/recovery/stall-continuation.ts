/**
 * Bounded execution-stall continue loop with protocol-violation isolation.
 * Extracted so tests can drive the loop without spinning the full embedded runner.
 */
import {
  EMPTY_AFTER_TOOLS_CONTINUE_PROMPT,
  EXECUTION_STALL_CONTINUE_PROMPT,
  FALSE_CONFIRM_CONTINUE_PROMPT,
  RECOVERABLE_TOOL_FAILURE_CONTINUE_PROMPT,
  SILENT_EXEC_CONTINUE_PROMPT,
  type ExecutionContinueKind,
} from "../../../agents/execution-stall-continue.js";
import { isProtocolViolationContinueBlocked } from "../../../agents/protocol-violation.js";

export type StallContinueDecision = {
  kind: ExecutionContinueKind | null;
  emptyContinue: boolean;
  stopText: string;
};

export type RunExecutionStallContinueLoopParams = {
  continueBudget: number;
  isAbortedOrTimedOut: () => boolean;
  /** Boundary flag and/or live messages after each hidden turn. */
  getProtocolBlock: () => { boundaryTerminated?: boolean; messages?: readonly unknown[] };
  resolveContinue: () => StallContinueDecision;
  sendContinue: (args: {
    kind: ExecutionContinueKind | "empty-after-tools";
    prompt: string;
  }) => Promise<void>;
  onContinued?: (kind: ExecutionContinueKind | "empty-after-tools", stopText: string) => void;
};

function promptForContinue(kind: ExecutionContinueKind | "empty-after-tools"): string {
  switch (kind) {
    case "silent-exec":
      return SILENT_EXEC_CONTINUE_PROMPT;
    case "false-confirm":
      return FALSE_CONFIRM_CONTINUE_PROMPT;
    case "empty-after-tools":
      return EMPTY_AFTER_TOOLS_CONTINUE_PROMPT;
    case "recoverable-tool-failure":
      return RECOVERABLE_TOOL_FAILURE_CONTINUE_PROMPT;
    case "progress-stall":
    default:
      return EXECUTION_STALL_CONTINUE_PROMPT;
  }
}

/**
 * Runs the bounded continue loop. Checks protocol termination at every
 * iteration start and immediately after each triggerTurn returns.
 */
export async function runExecutionStallContinueLoop(
  params: RunExecutionStallContinueLoopParams,
): Promise<{ continuesSent: number }> {
  let continuesSent = 0;
  for (let step = 0; step < params.continueBudget; step += 1) {
    if (params.isAbortedOrTimedOut()) {
      break;
    }
    if (isProtocolViolationContinueBlocked(params.getProtocolBlock())) {
      break;
    }
    const { kind, emptyContinue, stopText } = params.resolveContinue();
    if (!kind && !emptyContinue) {
      break;
    }
    const continueKind: ExecutionContinueKind | "empty-after-tools" = kind ?? "empty-after-tools";
    const prompt = promptForContinue(continueKind);
    try {
      await params.sendContinue({ kind: continueKind, prompt });
    } catch {
      break;
    }
    continuesSent += 1;
    // Hidden turn returned — isolate mid-loop pure-body violation before another model call.
    if (isProtocolViolationContinueBlocked(params.getProtocolBlock())) {
      break;
    }
    params.onContinued?.(continueKind, stopText);
  }
  return { continuesSent };
}
