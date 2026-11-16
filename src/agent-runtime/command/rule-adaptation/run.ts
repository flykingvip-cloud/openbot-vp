import { buildShadowSystemPrompt } from "../../context/rule-adaptation/prompt.js";
import type {
  ModelCompletion,
  ModelMessage,
  RuleAdaptationModelPort,
  ShadowHostPorts,
  ShadowOutcomeCode,
  ShadowReason,
  ShadowRunRequest,
  ShadowRunResult,
  ShadowUsageAccountingStatus,
} from "../../contracts/rule-adaptation-shadow.js";
import type { RuntimeRuleAdaptationValidationResult } from "../../contracts/rule-adaptation.js";
import {
  createBudgetTracker,
  invokeLimitedCompletion,
  type BudgetTracker,
} from "../../model/rule-adaptation/index.js";
import { validateRuntimeRuleProposal } from "../../policy/rule-adaptation/index.js";
import type { ControlledCandidateEntry } from "./candidate-entry.js";
import { buildShadowDiff } from "./compare.js";
import { cloneControlSnapshot, controlSnapshotsEqual } from "./control-snapshot.js";
import { detectProtocolOverride, intentToOutcome, parseShadowModelOutput } from "./parse.js";
import { buildShadowResult, mapValidationToOutcome, reason, validationReasons } from "./result.js";
import { createShadowToolExecutor, type ShadowToolExecutor } from "./tools.js";

export type ShadowRunDependencies = {
  host: ShadowHostPorts;
  model: RuleAdaptationModelPort;
  validate?: typeof validateRuntimeRuleProposal;
  candidateEntry?: ControlledCandidateEntry;
};

type LoopContext = {
  request: ShadowRunRequest;
  deps: ShadowRunDependencies;
  now: () => number;
  budget: BudgetTracker;
  tools: ShadowToolExecutor;
  diagnosedBeforeRetrieval: boolean;
  controlBefore: ReturnType<typeof cloneControlSnapshot>;
  messages: ModelMessage[];
  system: string;
  deadlineCleanupFailed: boolean;
  sessionDisposeFailed: boolean;
  usageKnown: boolean;
  underlyingRequestStopped: boolean;
  usageAccountingAttempted: boolean;
  usageAccountingStatus: ShadowUsageAccountingStatus;
  governanceOccupancyReady: boolean;
};

function snapshotAfter(ctx: LoopContext) {
  return cloneControlSnapshot(ctx.deps.host.controlBoard);
}

function finalize(
  ctx: LoopContext,
  outcomeCode: ShadowOutcomeCode,
  reasons: ShadowReason[],
  extras?: {
    validation?: RuntimeRuleAdaptationValidationResult;
    proposal?: unknown;
    shadowDiff?: ShadowRunResult["shadowDiff"];
  },
): ShadowRunResult {
  const after = snapshotAfter(ctx);
  return buildShadowResult({
    outcomeCode,
    reasons,
    usage: ctx.budget.usage(),
    limits: ctx.budget.limits,
    exhausted: ctx.budget.exhausted(),
    preEnforcedExhausted: ctx.budget.preEnforcedExhausted(),
    postAccountedExhausted: ctx.budget.postAccountedExhausted(),
    deadlineCleanupFailed: ctx.deadlineCleanupFailed,
    sessionDisposeFailed: ctx.sessionDisposeFailed,
    usageKnown: ctx.usageKnown,
    underlyingRequestStopped: ctx.underlyingRequestStopped,
    usageAccountingAttempted: ctx.usageAccountingAttempted,
    usageAccountingStatus: ctx.usageAccountingStatus,
    governanceOccupancyReady: ctx.governanceOccupancyReady,
    controlBefore: ctx.controlBefore,
    controlAfter: after,
    controlUnchanged: controlSnapshotsEqual(ctx.controlBefore, after),
    toolsInvoked: ctx.tools.journal(),
    rejectedTools: ctx.tools.rejected(),
    businessAttempts: ctx.tools.businessAttempts(),
    candidateToolInvoked: ctx.tools.candidateToolInvoked(),
    diagnosedBeforeRetrieval: ctx.diagnosedBeforeRetrieval,
    ...extras,
  });
}

function buildDiagnosis(request: ShadowRunRequest): Record<string, unknown> {
  return {
    recordedBy: "runner",
    summary: request.situation.summary,
    ...(request.situation.symptoms ? { symptoms: [...request.situation.symptoms] } : {}),
    ...(request.situation.scope ? { scope: request.situation.scope } : {}),
    known: request.situation.knownFacts ?? {},
    note: "Diagnosis was recorded before retrieval tools were enabled.",
  };
}

function mapNeedsInformation(validation: RuntimeRuleAdaptationValidationResult): ShadowOutcomeCode {
  const missing = [...validation.reasons, ...validation.items.flatMap((item) => item.reasons)].some(
    (entry) => entry.code === "missing_host_fact",
  );
  return missing ? "insufficient_sources" : "needs_information";
}

function applyProposal(
  ctx: LoopContext,
  proposal: unknown,
  extraReasons: ShadowReason[] = [],
): ShadowRunResult {
  const validate = ctx.deps.validate ?? validateRuntimeRuleProposal;
  const validation = validate(proposal, ctx.deps.host.view.hostFacts);
  let outcome = mapValidationToOutcome(validation);
  if (outcome === "needs_information") {
    outcome = mapNeedsInformation(validation);
  }
  return finalize(ctx, outcome, [...extraReasons, ...validationReasons(validation)], {
    validation,
    proposal,
    shadowDiff: buildShadowDiff(proposal, ctx.deps.host.view.hostFacts),
  });
}

async function callModel(ctx: LoopContext): Promise<ModelCompletion | ShadowRunResult> {
  const gate = ctx.budget.canStartModelCall();
  if (gate === "cancelled" || ctx.request.signal?.aborted) {
    ctx.budget.markCancelled(
      ctx.request.signal?.reason ? String(ctx.request.signal.reason) : "signal_aborted",
    );
    return finalize(ctx, "cancelled", [
      reason("cancelled", "The shadow run was cancelled.", "run.signal"),
    ]);
  }
  if (gate === "budget_exhausted") {
    return finalize(ctx, "budget_exhausted", [
      reason(
        "budget_exhausted",
        "A budget limit was reached before the next model call.",
        "run.budget",
      ),
    ]);
  }
  const remaining = ctx.budget.remaining();
  if (remaining.durationMs <= 0 || remaining.outputTokens <= 0) {
    return finalize(ctx, "budget_exhausted", [
      reason(
        "budget_exhausted",
        "A pre-enforced output or duration remainder was already zero.",
        "run.budget",
      ),
    ]);
  }
  try {
    const completion = await invokeLimitedCompletion({
      complete: (input) => ctx.deps.model.complete(input),
      input: {
        system: ctx.system,
        messages: ctx.messages,
        tools: ctx.tools.descriptors(),
        signal: ctx.request.signal,
        maxTokens: remaining.outputTokens,
        timeoutMs: remaining.durationMs,
      },
    });
    if (completion.deadlineCleanupFailed) {
      ctx.deadlineCleanupFailed = true;
    }
    if ("sessionDisposeFailed" in completion && completion.sessionDisposeFailed) {
      ctx.sessionDisposeFailed = true;
    }
    if ("usageKnown" in completion && !completion.usageKnown) {
      ctx.usageKnown = false;
    }
    if ("underlyingRequestStopped" in completion && !completion.underlyingRequestStopped) {
      ctx.underlyingRequestStopped = false;
    }
    if ("usageAccountingAttempted" in completion && completion.usageAccountingAttempted) {
      ctx.usageAccountingAttempted = true;
    }
    if ("usageAccountingStatus" in completion) {
      const status = completion.usageAccountingStatus;
      if (status === "failed") {
        ctx.usageAccountingStatus = "failed";
      } else if (status === "unknown" && ctx.usageAccountingStatus !== "failed") {
        ctx.usageAccountingStatus = "unknown";
      } else if (
        status === "succeeded" &&
        ctx.usageAccountingStatus !== "failed" &&
        ctx.usageAccountingStatus !== "unknown"
      ) {
        ctx.usageAccountingStatus = "succeeded";
      }
    }
    if ("governanceOccupancyReady" in completion && completion.governanceOccupancyReady === true) {
      ctx.governanceOccupancyReady = true;
    }
    // Unknown usage must not be booked as a successful zero tally.
    if (!("usageKnown" in completion) || completion.usageKnown) {
      ctx.budget.recordModelUsage(completion.usage);
    }
    if (completion.outputExceededMaxTokens) {
      return finalize(ctx, "budget_exhausted", [
        reason(
          "budget_exhausted",
          "The completion returned more output tokens than the remaining maxTokens cap. Usage was retained and accounted after the fact.",
          "run.budget",
        ),
      ]);
    }
    return completion;
  } catch (error) {
    if (
      ctx.request.signal?.aborted ||
      (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
      ctx.budget.markCancelled("model_aborted");
      const extracted =
        typeof error === "object" && error !== null && "usage" in error
          ? (error as { usage?: { inputTokens?: number; outputTokens?: number; cost?: number } })
              .usage
          : undefined;
      if (extracted) {
        ctx.budget.recordModelUsage({
          inputTokens: extracted.inputTokens ?? 0,
          outputTokens: extracted.outputTokens ?? 0,
          cost: extracted.cost ?? 0,
        });
      }
      return finalize(ctx, "cancelled", [
        reason("cancelled", "The model call was cancelled.", "run.signal"),
      ]);
    }
    return finalize(ctx, "protocol_failure", [
      reason(
        "protocol_failure",
        "The model port failed. No work was started and nothing was activated.",
        "model.port",
      ),
    ]);
  }
}

function handleTools(
  ctx: LoopContext,
  completion: Extract<ModelCompletion, { kind: "tool_calls" }>,
): void {
  ctx.messages.push({
    role: "assistant",
    content: completion.text ?? "",
    toolCalls: completion.toolCalls,
  });
  for (const call of completion.toolCalls) {
    const output = ctx.tools.execute(call.name, call.arguments);
    ctx.messages.push({
      role: "tool",
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify({
        untrustedMaterial: true,
        results: [{ toolCallId: call.id, ...output }],
      }),
    });
  }
}

function handleFinalMessage(ctx: LoopContext, text: string): ShadowRunResult | "revise" {
  const parsed = parseShadowModelOutput(text);
  if (detectProtocolOverride(text) && !parsed.ok) {
    return finalize(ctx, "malicious_material_rejected", [
      reason(
        "malicious_material_rejected",
        "Model output attempted to override the protocol.",
        "model.output",
      ),
    ]);
  }
  if (!parsed.ok) {
    return "revise";
  }
  if (parsed.hasForbiddenField) {
    if (parsed.proposal !== undefined) {
      return applyProposal(ctx, parsed.proposal, [
        reason(
          "malicious_material_rejected",
          "Proposal carried a forbidden field. The validator remains authoritative.",
          parsed.forbiddenPath ?? "proposal",
        ),
      ]);
    }
    return finalize(ctx, "malicious_material_rejected", [
      reason(
        "malicious_material_rejected",
        "Output included a forbidden authorization or activation field.",
        parsed.forbiddenPath ?? "model.output",
      ),
    ]);
  }
  if (parsed.proposal !== undefined) {
    return applyProposal(ctx, parsed.proposal);
  }
  const fromIntent = intentToOutcome(parsed.intent);
  if (fromIntent) {
    return finalize(ctx, fromIntent, [
      reason(fromIntent, "Structured intent recorded without a proposal.", "model.output"),
    ]);
  }
  return "revise";
}

/**
 * Read-only shadow rule-adaptation run. Never throws to the caller, never
 * activates policy, never writes configuration, and never persists candidates.
 */
export async function runShadowRuleAdaptation(
  request: ShadowRunRequest,
  deps: ShadowRunDependencies,
): Promise<ShadowRunResult> {
  const now = deps.host.now ?? Date.now;
  const controlBefore = cloneControlSnapshot(deps.host.controlBoard);
  const budget = createBudgetTracker(request.budget, now, request.signal);
  let diagnosedBeforeRetrieval = false;
  const tools = createShadowToolExecutor({
    view: deps.host.view,
    diagnosed: () => diagnosedBeforeRetrieval,
    candidateEntry: deps.candidateEntry,
  });
  const ctx: LoopContext = {
    request,
    deps,
    now,
    budget,
    tools,
    diagnosedBeforeRetrieval,
    controlBefore,
    messages: [],
    system: buildShadowSystemPrompt(),
    deadlineCleanupFailed: false,
    sessionDisposeFailed: false,
    usageKnown: true,
    underlyingRequestStopped: true,
    usageAccountingAttempted: false,
    usageAccountingStatus: "not_attempted",
    governanceOccupancyReady: false,
  };
  try {
    if (request.signal?.aborted) {
      budget.markCancelled("signal_aborted_before_start");
      return finalize(ctx, "cancelled", [
        reason(
          "cancelled",
          "Cancelled before the shadow run started. No work was promised.",
          "run.signal",
        ),
      ]);
    }
    const diagnosis = buildDiagnosis(request);
    diagnosedBeforeRetrieval = true;
    ctx.diagnosedBeforeRetrieval = true;
    ctx.messages.push({
      role: "user",
      content: JSON.stringify({
        requestId: request.requestId,
        diagnosis,
        instruction:
          "Diagnose already recorded. Retrieve only through read-only tools, then emit structured JSON.",
      }),
    });
    while (true) {
      const completion = await callModel(ctx);
      if (!("kind" in completion)) {
        return completion;
      }
      if (request.signal?.aborted || completion.kind === "cancelled") {
        budget.markCancelled(
          completion.kind === "cancelled" ? completion.reason : "signal_aborted",
        );
        return finalize(ctx, "cancelled", [
          reason("cancelled", "The shadow run was cancelled.", "run.signal"),
        ]);
      }
      if (completion.kind === "protocol_failure") {
        return finalize(ctx, "protocol_failure", [
          reason("protocol_failure", "The model reported a protocol failure.", "model.port"),
        ]);
      }
      if (completion.kind === "tool_calls") {
        handleTools(ctx, completion);
        continue;
      }
      const handled = handleFinalMessage(ctx, completion.text);
      if (handled !== "revise") {
        return handled;
      }
      if (request.signal?.aborted) {
        budget.markCancelled("signal_aborted");
        return finalize(ctx, "cancelled", [
          reason("cancelled", "The shadow run was cancelled.", "run.signal"),
        ]);
      }
      if (budget.revisionsRemaining() <= 0) {
        return finalize(ctx, "protocol_failure", [
          reason(
            "protocol_failure",
            "The model returned prose or invalid JSON, and no revision remains.",
            "model.output",
          ),
        ]);
      }
      const reviseGate = budget.canStartModelCall();
      if (reviseGate !== "ok") {
        if (reviseGate === "cancelled") {
          budget.markCancelled("signal_aborted");
          return finalize(ctx, "cancelled", [
            reason("cancelled", "The shadow run was cancelled.", "run.signal"),
          ]);
        }
        return finalize(ctx, "budget_exhausted", [
          reason(
            "budget_exhausted",
            "Budget was exhausted while waiting for structured output.",
            "run.budget",
          ),
        ]);
      }
      budget.recordRevision();
      ctx.messages.push({ role: "assistant", content: completion.text });
      ctx.messages.push({
        role: "user",
        content:
          "Your previous message was not valid structured JSON. Reply with the protocol JSON object only.",
      });
    }
  } catch {
    const after = snapshotAfter(ctx);
    return buildShadowResult({
      outcomeCode: "protocol_failure",
      reasons: [
        reason(
          "protocol_failure",
          "The shadow run failed safely and did not start execution.",
          "run",
        ),
      ],
      usage: budget.usage(),
      limits: budget.limits,
      exhausted: budget.exhausted(),
      preEnforcedExhausted: budget.preEnforcedExhausted(),
      postAccountedExhausted: budget.postAccountedExhausted(),
      deadlineCleanupFailed: ctx.deadlineCleanupFailed,
      sessionDisposeFailed: ctx.sessionDisposeFailed,
      usageKnown: ctx.usageKnown,
      underlyingRequestStopped: ctx.underlyingRequestStopped,
      usageAccountingAttempted: ctx.usageAccountingAttempted,
      usageAccountingStatus: ctx.usageAccountingStatus,
      governanceOccupancyReady: ctx.governanceOccupancyReady,
      controlBefore,
      controlAfter: after,
      controlUnchanged: controlSnapshotsEqual(controlBefore, after),
      toolsInvoked: tools.journal(),
      rejectedTools: tools.rejected(),
      businessAttempts: tools.businessAttempts(),
      candidateToolInvoked: tools.candidateToolInvoked(),
      diagnosedBeforeRetrieval,
    });
  }
}
