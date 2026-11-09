import { observeAcpCliSteerPreflight } from "../../../acp/cli-steer-preflight-observe.js";
import type { AcpSessionManager } from "../../../acp/control-plane/manager.js";
import { resolveAcpAgentPolicyError, resolveAcpDispatchPolicyError } from "../../../acp/policy.js";
import { toAcpRuntimeError } from "../../../acp/runtime/errors.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { resolveAgentIdFromSessionKey } from "../../../config/sessions.js";
import { emitAgentEvent, registerAgentRunContext } from "../../../infra/agent-events.js";
import { normalizeAgentId } from "../../../routing/session-key.js";
import { createAcpVisibleTextAccumulator } from "../../delivery/index.js";

/** ACP execution owns policy checks and lifecycle; state and dispatch keep their own boundaries. */
export async function runCommandAcpTurn({
  cfg,
  sessionKey,
  runId,
  body,
  agent,
  abortSignal,
  manager,
}: {
  cfg: OpenBotConfig;
  sessionKey: string;
  runId: string;
  body: string;
  agent?: string;
  abortSignal?: AbortSignal;
  manager: Pick<AcpSessionManager, "runTurn">;
}) {
  const startedAt = Date.now();
  registerAgentRunContext(runId, {
    sessionKey,
  });
  emitAgentEvent({
    runId,
    stream: "lifecycle",
    data: {
      phase: "start",
      startedAt,
    },
  });

  const visibleTextAccumulator = createAcpVisibleTextAccumulator();
  let stopReason: string | undefined;
  try {
    const dispatchPolicyError = resolveAcpDispatchPolicyError(cfg);
    if (dispatchPolicyError) {
      throw dispatchPolicyError;
    }
    const acpAgent = normalizeAgentId(agent || resolveAgentIdFromSessionKey(sessionKey));
    const agentPolicyError = resolveAcpAgentPolicyError(cfg, acpAgent);
    if (agentPolicyError) {
      throw agentPolicyError;
    }

    observeAcpCliSteerPreflight({
      kind: "cli-turn",
      cfg,
      sessionKey,
      agentId: acpAgent,
    });

    await manager.runTurn({
      cfg,
      sessionKey,
      text: body,
      mode: "prompt",
      requestId: runId,
      signal: abortSignal,
      onEvent: (event) => {
        if (event.type === "done") {
          stopReason = event.stopReason;
          return;
        }
        if (event.type !== "text_delta") {
          return;
        }
        if (event.stream && event.stream !== "output") {
          return;
        }
        if (!event.text) {
          return;
        }
        const visibleUpdate = visibleTextAccumulator.consume(event.text);
        if (!visibleUpdate) {
          return;
        }
        emitAgentEvent({
          runId,
          stream: "assistant",
          data: {
            text: visibleUpdate.text,
            delta: visibleUpdate.delta,
          },
        });
      },
    });
  } catch (error) {
    const acpError = toAcpRuntimeError({
      error,
      fallbackCode: "ACP_TURN_FAILED",
      fallbackMessage: "ACP turn failed before completion.",
    });
    emitAgentEvent({
      runId,
      stream: "lifecycle",
      data: {
        phase: "error",
        error: acpError.message,
        endedAt: Date.now(),
      },
    });
    throw acpError;
  }

  emitAgentEvent({
    runId,
    stream: "lifecycle",
    data: {
      phase: "end",
      endedAt: Date.now(),
    },
  });

  const finalTextRaw = visibleTextAccumulator.finalizeRaw();
  const finalText = visibleTextAccumulator.finalize();
  return { startedAt, stopReason, finalTextRaw, finalText };
}
