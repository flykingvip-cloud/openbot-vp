import {
  resolveEmbeddedModelGovernance,
  type EmbeddedModelGovernanceInput,
  type EmbeddedModelGovernanceParams,
} from "../../../agents/embedded-model-governance.js";
/**
 * Shared-governance adapter for the shadow agent.
 * Reuses createAuthorizedModelSession and resolveEmbeddedModelGovernance.
 * Callers must inject session ports, config, env, and the completion
 * implementation. This module does not read production credentials or keys.
 */
import type { OpenBotConfig } from "../../../config/config.js";
import type {
  ModelCompletion,
  RuleAdaptationModelPort,
  ShadowDiagnosticSink,
  ShadowUsageAccountingStatus,
} from "../../contracts/rule-adaptation-shadow.js";
import { createAuthorizedModelSession, type ModelSessionPorts } from "../index.js";
import { asModelUsage, zeroUsage } from "./budget.js";
import {
  invokeLimitedCompletion,
  type InvokeLimitedCompletionOptions,
} from "./completion-limits.js";
import type { CreateCombinedDeadline } from "./deadline.js";
import type { ShadowRegistryOccupancy } from "./occupancy.js";

export type ShadowGovernanceInput = EmbeddedModelGovernanceInput & {
  env?: NodeJS.ProcessEnv;
};

export function resolveShadowRuleAdaptationGovernance(
  input: ShadowGovernanceInput,
): EmbeddedModelGovernanceParams {
  const { env, ...embedded } = input;
  // Injected env only. An omitted env becomes an empty map so this path
  // never silently reads production process.env values or keys.
  return resolveEmbeddedModelGovernance(embedded, env ?? {});
}

export type ShadowModelCompleteFn = (
  input: Parameters<RuleAdaptationModelPort["complete"]>[0] & {
    governance: EmbeddedModelGovernanceParams;
    selectedProvider?: string;
    selectedModel?: string;
  },
) => Promise<ModelCompletion>;

export type GovernedShadowModelPortDeps = {
  runId: string;
  sessionPorts: ModelSessionPorts;
  complete: ShadowModelCompleteFn;
  /** Injected config object. Do not load production config here. */
  config: OpenBotConfig | Record<string, never>;
  authorizeInput?: Omit<
    Parameters<ModelSessionPorts["admission"]["tryAcquireEnterpriseAgentRun"]>[0],
    "runId"
  >;
  routing?: { allowlist?: readonly string[]; preferredModelOrder?: string[] };
  actorId?: string;
  env?: NodeJS.ProcessEnv;
  provider?: string;
  model?: string;
  createSession?: typeof createAuthorizedModelSession;
  resolveGovernance?: typeof resolveEmbeddedModelGovernance;
  createDeadline?: CreateCombinedDeadline;
  wrapCleanup?: InvokeLimitedCompletionOptions["wrapCleanup"];
  /**
   * Existing registry-cap + stale-reap occupancy. When omitted, this port is
   * not occupancy-ready: fixture admission and deferred dispose cannot bound
   * held slots, and the result must not be used as P2 治理验收.
   */
  occupancy?: ShadowRegistryOccupancy;
  diagnosticSink?: ShadowDiagnosticSink;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      ((error as { name: string }).name === "AbortError" ||
        (error as { name: string }).name === "TimeoutError"))
  );
}

function cancelled(reason: string, usage = zeroUsage()): ModelCompletion {
  return { kind: "cancelled", usage, reason };
}

function protocolFailure(detail: string, usage = zeroUsage()): ModelCompletion {
  return { kind: "protocol_failure", usage, detail };
}

function usageOf(value: unknown) {
  return asModelUsage(
    typeof value === "object" && value !== null && "usage" in value
      ? (value as { usage?: Partial<{ inputTokens: number; outputTokens: number; cost: number }> })
          .usage
      : undefined,
  );
}

function whenUnderlyingSettledOf(value: unknown): Promise<void> | undefined {
  if (typeof value !== "object" || value === null || !("whenUnderlyingSettled" in value)) {
    return undefined;
  }
  const pending = (value as { whenUnderlyingSettled: unknown }).whenUnderlyingSettled;
  return pending instanceof Promise ? pending : undefined;
}

function underlyingStillRunning(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "underlyingRequestStopped" in value &&
    (value as { underlyingRequestStopped: unknown }).underlyingRequestStopped === false
  );
}

export type GovernedModelCompletion = ModelCompletion & {
  sessionDisposeFailed?: boolean;
  usageKnown?: boolean;
  underlyingRequestStopped?: boolean;
  whenUnderlyingSettled?: Promise<void>;
  usageAccountingAttempted?: boolean;
  usageAccountingStatus?: ShadowUsageAccountingStatus;
  /** True only when `occupancy` was injected for this port. */
  governanceOccupancyReady?: boolean;
};

function freezeGovernedSnapshot(completion: GovernedModelCompletion): GovernedModelCompletion {
  return Object.freeze({
    ...completion,
    usage: Object.freeze({ ...completion.usage }),
  }) as GovernedModelCompletion;
}

function accountingOf(value: unknown): {
  usageAccountingAttempted: boolean;
  usageAccountingStatus: ShadowUsageAccountingStatus;
} {
  if (typeof value !== "object" || value === null) {
    return { usageAccountingAttempted: false, usageAccountingStatus: "not_attempted" };
  }
  const attempted = (value as { usageAccountingAttempted?: unknown }).usageAccountingAttempted;
  const status = (value as { usageAccountingStatus?: unknown }).usageAccountingStatus;
  return {
    usageAccountingAttempted: attempted === true,
    usageAccountingStatus:
      status === "succeeded" ||
      status === "failed" ||
      status === "unknown" ||
      status === "not_attempted"
        ? status
        : "not_attempted",
  };
}

/**
 * Port that books a governed authorized session, then delegates the actual
 * completion to an injected function. Remaining output tokens and duration
 * are passed through as `maxTokens` and `timeoutMs`, with a combined abort
 * signal. Tests supply a fixture completion and fixture session ports so no
 * production model call or key read occurs.
 */
export function createGovernedShadowModelPort(
  deps: GovernedShadowModelPortDeps,
): RuleAdaptationModelPort {
  const createSession = deps.createSession ?? createAuthorizedModelSession;
  const resolveGovernance = deps.resolveGovernance ?? resolveEmbeddedModelGovernance;

  return {
    async complete(input) {
      if (input.signal?.aborted) {
        return cancelled("signal_aborted_before_session");
      }
      const session = createSession(deps.runId, deps.sessionPorts);
      let retained = zeroUsage();
      let sessionDisposeFailed = false;
      let result: GovernedModelCompletion | undefined;
      let deferDisposeUntil: Promise<void> | undefined;
      let snapshotReturned = false;
      const occupancy = deps.occupancy;
      try {
        const admission = await session.authorize(deps.authorizeInput ?? {});
        if (!admission.acquired && !admission.skipped) {
          result = protocolFailure("model_admission_denied");
        } else {
          if (admission.acquired && occupancy) {
            occupancy.watch(deps.runId, session);
          }
          const routing = {
            allowlist: deps.routing?.allowlist,
            preferredModelOrder: deps.routing?.preferredModelOrder,
          };
          const governance = resolveGovernance(
            {
              gateStatus: admission.acquired ? "acquired" : "skipped",
              allowlist: routing.allowlist,
              actorId: deps.actorId,
            },
            deps.env ?? {},
          );
          session.prepareModelSet({
            config: deps.config as OpenBotConfig,
            actorId: deps.actorId,
            routing: routing as Parameters<typeof session.prepareModelSet>[0]["routing"],
          });
          const inferred = await session.infer({
            cfg: deps.config as OpenBotConfig,
            provider: deps.provider ?? "shadow-fixture",
            model: deps.model ?? "shadow-fixture",
            taskText: "rule-adaptation-shadow",
            // Do not pass the external cancel signal into infer().
            // `createAuthorizedModelSession.infer` calls throwIfAborted after
            // `run()` returns, which would drop a handled cancel/timeout
            // LimitedCompletion (including whenUnderlyingSettled) and dispose
            // a still-running request immediately. The wait itself already
            // responds to the signal inside invokeLimitedCompletion.
            run: async (provider, model) =>
              invokeLimitedCompletion({
                complete: (limited) =>
                  deps.complete({
                    ...limited,
                    governance,
                    selectedProvider: provider,
                    selectedModel: model,
                  }),
                input: limitedInput(input),
                createDeadline: deps.createDeadline,
                wrapCleanup: deps.wrapCleanup,
                diagnosticSink: deps.diagnosticSink,
                usageRecorder: {
                  recordUsage: async ({ usage, durationMs, reason }) => {
                    void reason;
                    retained = usage;
                    const outcome = await session.recordUsage({
                      provider,
                      model,
                      usage,
                      durationMs,
                      toolCallCount: 0,
                      toolClasses: [],
                      fallbackAttemptsRaw: [],
                    });
                    if (outcome === undefined) {
                      // No creditReporting on this session: correctly skipped.
                      return { attempted: false, recorded: false, deduped: false };
                    }
                    return {
                      attempted: true,
                      recorded: outcome.recorded,
                      deduped: outcome.deduped,
                    };
                  },
                },
              }),
          });
          const completion = unwrapCompletion(inferred, retained);
          retained = asModelUsage(completion.usage);
          if (underlyingStillRunning(completion)) {
            deferDisposeUntil = whenUnderlyingSettledOf(completion);
          }
          if (input.signal?.aborted) {
            // Keep the return-time snapshot fields from the limited
            // completion; only the kind/reason reflect the external cancel.
            result = {
              ...cancelled("signal_aborted_after_infer", retained),
              ...accountingOf(completion),
              usageKnown: (completion as { usageKnown?: boolean }).usageKnown,
              underlyingRequestStopped: (completion as { underlyingRequestStopped?: boolean })
                .underlyingRequestStopped,
              whenUnderlyingSettled: whenUnderlyingSettledOf(completion),
            };
          } else {
            result = completion;
          }
        }
      } catch (error) {
        const fromError = usageOf(error);
        if (fromError.inputTokens + fromError.outputTokens + fromError.cost > 0) {
          retained = fromError;
        }
        if (input.signal?.aborted || isAbortError(error)) {
          result = cancelled("signal_aborted", retained);
        } else {
          result = protocolFailure(
            error instanceof Error ? error.message : "model_protocol_failure",
            retained,
          );
        }
      } finally {
        const disposeSession = async (): Promise<void> => {
          try {
            await session.dispose();
          } catch {
            sessionDisposeFailed = true;
            if (snapshotReturned) {
              // The caller already holds a frozen return-time snapshot.
              // Report the late failure through the diagnostic sink only.
              deps.diagnosticSink?.report({
                kind: "session_dispose_failed",
                sessionDisposeFailed: true,
              });
            }
          } finally {
            occupancy?.unwatch(deps.runId);
          }
        };
        if (deferDisposeUntil) {
          // Return the timeout/cancel verdict without waiting. Dispose only
          // after late usage has been offered to session.recordUsage, so a
          // still-pending completion can still be accounted once. If official
          // stale reap already finished this run, occupancy will dispose the
          // in-memory session earlier — reuse of that existing limit, not an
          // early-release of a still-counted slot.
          void deferDisposeUntil.then(disposeSession, disposeSession);
        } else {
          await disposeSession();
        }
      }
      const finished = result ?? protocolFailure("completion_missing", retained);
      const accounting = accountingOf(finished);
      const snapshot = freezeGovernedSnapshot({
        ...finished,
        sessionDisposeFailed,
        usageAccountingAttempted: accounting.usageAccountingAttempted,
        usageAccountingStatus: accounting.usageAccountingStatus,
        governanceOccupancyReady: occupancy?.governanceOccupancyReady === true,
      });
      snapshotReturned = true;
      return snapshot;
    },
  };
}

function limitedInput(input: Parameters<RuleAdaptationModelPort["complete"]>[0]) {
  return {
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    signal: input.signal,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
  };
}

function unwrapCompletion(inferred: unknown, fallback = zeroUsage()): ModelCompletion {
  if (isCompletion(inferred)) {
    return { ...inferred, usage: asModelUsage(inferred.usage) };
  }
  if (typeof inferred === "object" && inferred !== null && "result" in inferred) {
    const inner = (inferred as { result: unknown }).result;
    if (isCompletion(inner)) {
      return { ...inner, usage: asModelUsage(inner.usage) };
    }
  }
  return protocolFailure("ungoverned_or_unrecognized_inference_result", fallback);
}

function isCompletion(value: unknown): value is ModelCompletion {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const kind = (value as { kind: unknown }).kind;
  return (
    kind === "message" ||
    kind === "tool_calls" ||
    kind === "cancelled" ||
    kind === "protocol_failure"
  );
}

/** Reuse the host's resolved provider/credential; never load a second credential source. */
export function createHostShadowCompletion(
  resolveCandidate: (
    provider: string,
    model: string,
  ) => Promise<{
    model: import("@earendil-works/pi-ai/compat").Model<import("@earendil-works/pi-ai/compat").Api>;
    apiKey?: string;
  }>,
): ShadowModelCompleteFn {
  return async (input) => {
    const { complete } = await import("@earendil-works/pi-ai/compat");
    const { Type } = await import("@sinclair/typebox");
    const candidate = await resolveCandidate(
      input.selectedProvider ?? "",
      input.selectedModel ?? "",
    );
    const response = await complete(
      candidate.model,
      {
        systemPrompt: input.system,
        messages: input.messages.map((message): import("@earendil-works/pi-ai/compat").Message => {
          if (message.role === "tool") {
            if (!message.toolCallId || !message.toolName) {
              throw new Error("Missing shadow tool correlation");
            }
            return {
              role: "toolResult",
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              content: [{ type: "text", text: message.content }],
              isError: false,
              timestamp: Date.now(),
            };
          }
          if (message.role === "assistant") {
            return {
              role: "assistant",
              api: candidate.model.api,
              provider: candidate.model.provider,
              model: candidate.model.id,
              content: [
                ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
                ...(message.toolCalls ?? []).map((call) => {
                  if (
                    !call.arguments ||
                    typeof call.arguments !== "object" ||
                    Array.isArray(call.arguments)
                  ) {
                    throw new Error("Invalid shadow tool arguments");
                  }
                  return {
                    type: "toolCall" as const,
                    id: call.id,
                    name: call.name,
                    arguments: call.arguments as Record<string, unknown>,
                  };
                }),
              ],
              stopReason: message.toolCalls?.length ? "toolUse" : "stop",
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              timestamp: Date.now(),
            };
          }
          return { role: "user", content: message.content, timestamp: Date.now() };
        }),
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: Type.Object({}, { additionalProperties: true }),
        })),
      },
      {
        apiKey: candidate.apiKey,
        signal: input.signal,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
      },
    );
    const usage = {
      inputTokens: response.usage.input,
      outputTokens: response.usage.output,
      cost: response.usage.cost.total,
    };
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      return { kind: "protocol_failure", usage, detail: "host_shadow_completion_failed" };
    }
    const toolCalls = response.content.flatMap((part) =>
      part.type === "toolCall" ? [{ id: part.id, name: part.name, arguments: part.arguments }] : [],
    );
    const text = response.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    return toolCalls.length
      ? { kind: "tool_calls", toolCalls, text, usage }
      : { kind: "message", text, usage };
  };
}
