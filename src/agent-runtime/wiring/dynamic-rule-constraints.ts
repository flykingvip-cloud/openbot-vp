import { createHash } from "node:crypto";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { FollowupRun } from "../../auto-reply/reply/queue.js";
import { runRuleAgentLibraryCycle } from "../command/rule-adaptation/index.js";
import type { ContextWindowDecisionSwitch } from "../model/rule-adaptation/index.js";
import { evaluateExecutionRuleAdoption } from "../policy/rule-adaptation/index.js";
import { sessionTaskState } from "../state/index.js";
import { recordNormalTaskRuleAdvice, type GatewayInteractionParams } from "./interaction-turn.js";

type DynamicRuleInput = {
  runId: string;
  sessionFile: string;
  provider: string;
  modelId: string;
  signal?: AbortSignal;
};

function shadowProposedTokens(
  proposal: unknown,
  validationKind: string | undefined,
): number | undefined {
  if (validationKind !== "shadow_accepted") {
    return undefined;
  }
  if (!proposal || typeof proposal !== "object" || !("items" in proposal)) {
    return undefined;
  }
  const items = proposal.items;
  if (!Array.isArray(items) || items.length !== 1) {
    return undefined;
  }
  const item = items[0];
  if (!item || typeof item !== "object" || typeof item.proposedValue !== "number") {
    return undefined;
  }
  return item.proposedValue;
}

/**
 * Dynamic-mode constraint decision inside the admitted turn.
 * Legacy mode never calls this. A library failure falls through to the
 * existing per-run adoption path and does not stop the executor.
 */
export async function resolveDynamicExecutionConstraints(args: {
  run: FollowupRun["run"];
  commandBody: string;
  sessionKey?: string;
  fallback: "legacy" | "block";
  input: DynamicRuleInput;
  advise?: typeof recordNormalTaskRuleAdvice;
}): Promise<ContextWindowDecisionSwitch> {
  const { run, input } = args;
  const advise = args.advise ?? recordNormalTaskRuleAdvice;
  const binding = run.taskCompletionBinding;
  const turn = run.turnExecutionAdmission;
  if (!binding && !turn) {
    return { mode: "dynamic", fallback: args.fallback };
  }
  const board = sessionTaskState.read(run.sessionFile);
  const adviceParams: GatewayInteractionParams = {
    config: run.config,
    runId: input.runId,
    agentId: run.agentId,
    agentDir: run.agentDir ?? resolveAgentDir(run.config, run.agentId),
    sessionFile: run.sessionFile,
    sessionKey: args.sessionKey,
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
    input: { message: args.commandBody, context: [], abortSignal: input.signal },
  };
  const advice = await advise(adviceParams, {
    kind: "execution_admission",
    result: binding
      ? { kind: "accepted", binding, acceptance: [] }
      : { kind: "accepted_turn", admission: turn! },
  });
  if (!advice || !advice.result.controlUnchanged) {
    return { mode: "dynamic", fallback: args.fallback };
  }
  input.signal?.throwIfAborted();
  const bindingCurrent = binding
    ? sessionTaskState.bindingCurrent(run.sessionFile, binding)
    : Boolean(turn && sessionTaskState.turnAdmissionCurrent(run.sessionFile, turn));
  if (!bindingCurrent) {
    return { mode: "dynamic", fallback: args.fallback };
  }
  const library = runRuleAgentLibraryCycle({
    permission: {
      caller: "rule-agent",
      mode: "dynamic",
      authorized: run.executionAdmitted === true,
      bindingCurrent: true,
      cancelled: input.signal?.aborted ?? false,
      collaboration: Boolean(run.executionIdentity?.collaborationGroupId),
    },
    sessionFile: run.sessionFile,
    message: args.commandBody,
    currentTokens: advice.currentTokens,
    ruleVersion: advice.ruleVersion,
    shadowProposedTokens:
      advice.result.outcomeCode === "no_change_needed"
        ? undefined
        : shadowProposedTokens(advice.result.proposal, advice.result.validation?.resultKind),
  });
  let effectiveTokens = advice.currentTokens;
  if (library.applied) {
    effectiveTokens = library.effectiveTokens;
  } else if (advice.result.outcomeCode !== "no_change_needed") {
    const proposal = advice.result.proposal;
    if (
      !proposal ||
      typeof proposal !== "object" ||
      !("items" in proposal) ||
      !Array.isArray(proposal.items) ||
      proposal.items.length !== 1 ||
      advice.result.validation?.resultKind !== "shadow_accepted"
    ) {
      return { mode: "dynamic", fallback: args.fallback };
    }
    const item = proposal.items[0];
    if (!item || typeof item !== "object" || typeof item.proposedValue !== "number") {
      return { mode: "dynamic", fallback: args.fallback };
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
      return { mode: "dynamic", fallback: args.fallback };
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
      return { mode: "dynamic", fallback: args.fallback };
    }
    effectiveTokens = adopted.value;
  }
  return {
    mode: "dynamic",
    fallback: args.fallback,
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
            ...(library.applied
              ? { libraryRevision: library.revision, sceneClass: library.sceneClass }
              : {}),
          }),
        )
        .digest("hex"),
    },
  };
}
