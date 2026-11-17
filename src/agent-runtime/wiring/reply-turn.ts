import { createHash } from "node:crypto";
import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "../../task-outcome/runtime-from-runner.js";
import {
  isHumanInteractionIngress,
  type GovernedInteractionResult,
  type GovernedInteractionWithShadow,
  type GovernedShadowHostInjection,
} from "../command/index.js";
import {
  buildReplyPayloads,
  completeReplyDelivery,
  prepareVisibleDelivery,
} from "../delivery/index.js";
import {
  runAdmittedTurn,
  isTaskBoardContinueInternalPrompt,
  scheduleTaskBoardContinueWake,
} from "../execution/index.js";
import { resolveExecutionQueueAction } from "../policy/index.js";
import { evaluateExecutionRuleAdoption } from "../policy/rule-adaptation/index.js";
import { sessionTaskState, prepareReplacementSessionEntry } from "../state/index.js";
import {
  persistInteractionMessage as writeInteractionTranscriptMessage,
  persistRunSessionUsage,
  incrementRunCompactionCount,
} from "../state/index.js";
import { bindAdmittedTurnHost } from "./admitted-turn-host.js";
import { confirmPendingTurnDelivery } from "./delivery-confirm.js";
import { interruptInteractionTask, steerInteractionTask } from "./interaction-effects.js";
import type { GatewayInteractionParams } from "./interaction-turn.js";
import { evaluateBoundTaskAcceptance } from "./task-acceptance.js";

/** Compose the original reply-turn dependencies. The reply host owns transport and cleanup. */
export const replyTurnRuntime = {
  isHumanInteractionIngress,
  prepareReplacementSessionEntry,
  persistInteractionMessage(
    input: Parameters<typeof writeInteractionTranscriptMessage>[0],
  ): ReturnType<typeof writeInteractionTranscriptMessage> {
    return writeInteractionTranscriptMessage(input);
  },
  interaction: (async (
    params: GatewayInteractionParams,
    shadowHost?: GovernedShadowHostInjection,
  ) => {
    const runtime = await import("./interaction-turn.runtime.js");
    if (shadowHost?.trigger === true) {
      return runtime.runGatewayInteraction(params, shadowHost);
    }
    return runtime.runGatewayInteraction(params);
  }) as {
    (
      params: GatewayInteractionParams,
      shadowHost: GovernedShadowHostInjection,
    ): Promise<GovernedInteractionWithShadow>;
    (params: GatewayInteractionParams): Promise<GovernedInteractionResult>;
  },
  interrupt: interruptInteractionTask,
  steer: steerInteractionTask,
  state: { ...sessionTaskState, persistRunSessionUsage, incrementRunCompactionCount },
  execution: {
    resolveQueueAction: resolveExecutionQueueAction,
    isTaskBoardContinueInternalPrompt,
    scheduleTaskBoardContinueWake,
    runAdmittedTurn(request: Parameters<typeof runAdmittedTurn>[0]) {
      const run = request.followupRun.run;
      const policy = run.config.agents?.defaults?.contextWindowRuleDecision;
      if (policy?.mode === "dynamic") {
        request = {
          ...request,
          resolveExecutionConstraints: async (input) => {
            const binding = run.taskCompletionBinding;
            const turn = run.turnExecutionAdmission;
            if (!binding && !turn) {
              return { mode: "dynamic", fallback: policy.fallback };
            }
            const runtime = await import("./interaction-turn.js");
            const board = sessionTaskState.read(run.sessionFile);
            const advice = await runtime.recordNormalTaskRuleAdvice(
              {
                config: run.config,
                runId: input.runId,
                agentId: run.agentId,
                agentDir: run.agentDir ?? resolveAgentDir(run.config, run.agentId),
                sessionFile: run.sessionFile,
                sessionKey: request.sessionKey,
                requestId: input.runId,
                authorized: run.executionAdmitted === true,
                captured: {
                  expectedFocusRevision: board.focusRevision ?? 0,
                  expectedWriteEpoch: board.writeEpoch ?? 0,
                },
                identity: run,
                provider: input.provider,
                model: input.modelId,
                timeoutMs: run.timeoutMs,
                input: { message: request.commandBody, context: [], abortSignal: input.signal },
              },
              {
                kind: "execution_admission",
                result: binding
                  ? { kind: "accepted", binding, acceptance: [] }
                  : { kind: "accepted_turn", admission: turn! },
              },
            );
            if (!advice || !advice.result.controlUnchanged) {
              return { mode: "dynamic", fallback: policy.fallback };
            }
            input.signal?.throwIfAborted();
            if (
              binding
                ? !sessionTaskState.bindingCurrent(run.sessionFile, binding)
                : !turn || !sessionTaskState.turnAdmissionCurrent(run.sessionFile, turn)
            ) {
              return { mode: "dynamic", fallback: policy.fallback };
            }
            let effectiveTokens = advice.currentTokens;
            if (advice.result.outcomeCode !== "no_change_needed") {
              const proposal = advice.result.proposal;
              if (
                !proposal ||
                typeof proposal !== "object" ||
                !("items" in proposal) ||
                !Array.isArray(proposal.items) ||
                proposal.items.length !== 1 ||
                advice.result.validation?.resultKind !== "shadow_accepted"
              ) {
                return { mode: "dynamic", fallback: policy.fallback };
              }
              const item = proposal.items[0];
              if (!item || typeof item !== "object" || typeof item.proposedValue !== "number") {
                return { mode: "dynamic", fallback: policy.fallback };
              }
              const scope = {
                type: "personal" as const,
                id: binding?.taskId ?? `turn:${input.runId}`,
              };
              if (
                !("scope" in proposal) ||
                !proposal.scope ||
                typeof proposal.scope !== "object" ||
                !("type" in proposal.scope) ||
                !("id" in proposal.scope)
              ) {
                return { mode: "dynamic", fallback: policy.fallback };
              }
              const adopted = evaluateExecutionRuleAdoption({
                mode: "dynamic",
                authorized: run.executionAdmitted === true,
                scope,
                proposalScope: { type: proposal.scope.type, id: proposal.scope.id } as typeof scope,
                bindingCurrent: true,
                cancelled: input.signal?.aborted ?? false,
                ruleId: item.ruleId,
                field: item.field,
                action: item.action,
                currentValue: advice.currentTokens,
                proposedValue: item.proposedValue,
              });
              if (!adopted.allowed) {
                return { mode: "dynamic", fallback: policy.fallback };
              }
              effectiveTokens = adopted.value;
            }
            return {
              mode: "dynamic",
              fallback: policy.fallback,
              revalidate: () =>
                !input.signal?.aborted &&
                (binding
                  ? sessionTaskState.bindingCurrent(run.sessionFile, binding)
                  : Boolean(turn && sessionTaskState.turnAdmissionCurrent(run.sessionFile, turn))),
              snapshot: {
                domain: "context_window",
                ruleId: "model.context_window.guard",
                decisionId: `${input.provider}/${input.modelId}:context-window`,
                effectiveTokens,
                originalTokens: advice.currentTokens,
                sourceVersion: advice.ruleVersion,
                policyHash: createHash("sha256")
                  .update(
                    JSON.stringify({
                      rule: "model.context_window.guard",
                      version: advice.ruleVersion,
                      effectiveTokens,
                      runId: input.runId,
                    }),
                  )
                  .digest("hex"),
              },
            };
          },
        };
      }
      return runAdmittedTurn(request, bindAdmittedTurnHost());
    },
  },
  delivery: {
    confirmPendingTurnDelivery,
    buildReplyPayloads,
    completeReplyDelivery,
    prepareVisibleDelivery(
      config: OpenBotConfig,
      request: Omit<
        Parameters<typeof prepareVisibleDelivery>[0],
        "resolvePersistRoot" | "evaluateAcceptance"
      > & { workspaceDir?: string },
    ) {
      return prepareVisibleDelivery({
        ...request,
        evaluateAcceptance: () => evaluateBoundTaskAcceptance(request),
        resolvePersistRoot: (agentId) =>
          path.join(resolveAgentDir(config, agentId), TASK_OUTCOME_STORE_DIRNAME),
      });
    },
  },
};
