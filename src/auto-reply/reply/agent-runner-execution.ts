/** Compatibility entry only. The single turn orchestration lives in runtime execution. */
import { runAdmittedTurn } from "../../agent-runtime/execution/index.js";
import type {
  AgentTurnExecutionParams,
  AgentRunLoopResult,
} from "../../agent-runtime/execution/index.js";
import { bindAdmittedTurnHost } from "../../agent-runtime/wiring/admitted-turn-host.js";
export type { RuntimeFallbackAttempt } from "./agent-run-credit-usage.js";
export type {
  AgentTurnExecutionParams,
  AgentRunLoopResult,
} from "../../agent-runtime/execution/index.js";
export function runAgentTurnWithFallback(
  params: AgentTurnExecutionParams,
): Promise<AgentRunLoopResult> {
  return runAdmittedTurn(params, bindAdmittedTurnHost());
}
