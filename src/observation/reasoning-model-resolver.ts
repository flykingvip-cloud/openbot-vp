/** Governed metadata-only inference. No task/session transitions or model-directory preparation. */
import { randomUUID } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import {
  createAuthorizedModelSession,
  invokeMetadataCompletion,
  type ModelSessionPorts,
} from "../agent-runtime/model/index.js";
import { bindAdmittedTurnHost } from "../agent-runtime/wiring/admitted-turn-host.js";
import {
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
  resolveRunModelFallbacksOverride,
} from "../agents/agent-scope.js";
import { loadAuthProfileStoreForSecretsRuntime } from "../agents/auth-profiles.js";
import { getApiKeyForModel } from "../agents/model-auth.js";
import { parseModelRef } from "../agents/model-selection.js";
import type { OpenBotConfig } from "../config/config.js";
import { usageFromUnknown } from "../executor-evidence/model-call-evidence.js";
import { resolveEnterpriseEmbeddedTransport } from "../gateway/enterprise-model/embedded-transport.js";
import type { GatewayClient } from "../gateway/server-methods/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ReasoningDiagnostics, ReasoningModelPort } from "./reasoning-pass.js";

export type ReasoningResolverContext = {
  cfg: OpenBotConfig;
  agentId: string;
  tenantId: string | null;
  subjectRef: string;
  client: GatewayClient;
  authorize: () => Promise<boolean>;
};
type Candidate = { model: Model<Api>; apiKey?: string };
/** Server-only test seams. Never decoded from a request. */
export type ReasoningResolverPorts = {
  host?: ReturnType<typeof bindAdmittedTurnHost>;
  candidate?: (provider: string, model: string, signal: AbortSignal) => Promise<Candidate>;
  complete?: typeof invokeMetadataCompletion;
};
const log = createSubsystemLogger("observation-reasoning");
/** A cancelled wait owns its late result; it never retries an uncertain effect. */
function waitForDeadline<T>(
  start: () => Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => Promise<void>,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(new Error("reasoning_timeout"));
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return start();
      })
      .then(
        (value) => {
          if (settled) {
            if (late) {
              void late(value).catch(() =>
                log.warn("Late reasoning admission cleanup failed; release remains unconfirmed"),
              );
            }
            return;
          }
          settled = true;
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    if (signal.aborted) {
      abort();
    }
  });
}
async function readCandidate(
  ctx: ReasoningResolverContext,
  provider: string,
  modelId: string,
  signal: AbortSignal,
): Promise<Candidate> {
  signal.throwIfAborted();
  const transport = await resolveEnterpriseEmbeddedTransport({
    provider,
    model: modelId,
    tenantId: ctx.tenantId,
  });
  // Only an explicit existing configured definition is accepted. No discovery/ensure,
  // generated models.json, synthesized model metadata, or guessed endpoint.
  const config = ctx.cfg.models?.providers?.[transport.provider];
  const definition = config?.models.find((item) => item.id === transport.model);
  const api = definition?.api ?? config?.api;
  const baseUrl = transport.providerAuthOverride?.baseUrl ?? config?.baseUrl;
  if (
    !definition ||
    !api ||
    !baseUrl ||
    !Number.isFinite(definition.maxTokens) ||
    definition.maxTokens <= 0
  ) {
    throw new Error("reasoning_model_metadata_missing");
  }
  const model: Model<Api> = { ...definition, api, baseUrl, provider: transport.provider };
  const agentDir = resolveAgentDir(ctx.cfg, ctx.agentId);
  const store = loadAuthProfileStoreForSecretsRuntime(agentDir);
  if (
    !transport.providerAuthOverride &&
    (transport.provider === "github-copilot" ||
      Object.values(store.profiles).some(
        (profile) => profile.provider === transport.provider && profile.type === "oauth",
      ))
  ) {
    throw new Error("reasoning_readonly_credential_unavailable");
  }
  const auth = await getApiKeyForModel({
    model,
    cfg: ctx.cfg,
    agentDir,
    store,
    ...(transport.providerAuthOverride ? { authOverride: transport.providerAuthOverride } : {}),
  });
  signal.throwIfAborted();
  if (!auth.apiKey && auth.mode !== "aws-sdk") {
    throw new Error("reasoning_credential_missing");
  }
  return { model, ...(auth.apiKey ? { apiKey: auth.apiKey } : {}) };
}
export function createReasoningModelResolver(
  ctx: ReasoningResolverContext,
  ports: ReasoningResolverPorts = {},
) {
  const primary = resolveAgentEffectiveModelPrimary(ctx.cfg, ctx.agentId);
  const ref = primary ? parseModelRef(primary, "anthropic") : null;
  const modelRef = ref ? ref.provider + "/" + ref.model : "unconfigured";
  let diagnostics: ReasoningDiagnostics | undefined;
  const model: ReasoningModelPort = async (metadata, request) => {
    diagnostics = {
      reconciliationRef: randomUUID(),
      retention: "process_only",
      usageStatus: "not_observed",
      cleanupStatus: "not_acquired",
      observedUsage: null,
      reasonCodes: [],
    };
    const state = diagnostics;
    const reason = (code: string) => {
      if (!state.reasonCodes.includes(code)) {
        state.reasonCodes.push(code);
      }
    };
    const release = async (host: ReturnType<typeof bindAdmittedTurnHost>, runId: string) => {
      state.cleanupStatus = "pending";
      try {
        await waitForDeadline(
          () => host.admission.releaseEnterpriseAgentRun(runId),
          AbortSignal.timeout(100),
        );
        state.cleanupStatus = "released";
      } catch {
        state.cleanupStatus = "cleanup_unconfirmed";
        reason("cleanup_unconfirmed");
        throw new Error("cleanup_unconfirmed");
      }
    };
    if (
      !ref ||
      !ctx.tenantId?.trim() ||
      !ctx.client.user?.trim() ||
      !ctx.client.platformUserId?.trim() ||
      !(await waitForDeadline(ctx.authorize, request.signal))
    ) {
      throw new Error("reasoning_consumer_identity_missing");
    }
    request.signal.throwIfAborted();
    const host = ports.host ?? bindAdmittedTurnHost();
    const session = createAuthorizedModelSession("observation-reasoning:" + randomUUID(), {
      ...host,
      admission: {
        ...host.admission,
        tryAcquireEnterpriseAgentRun: (input) =>
          waitForDeadline(
            () => host.admission.tryAcquireEnterpriseAgentRun(input),
            request.signal,
            async (result) => {
              if (result.acquired) {
                await release(host, input.runId);
              }
            },
          ),
        releaseEnterpriseAgentRun: (runId) => release(host, runId),
      },
    } satisfies ModelSessionPorts);
    const recheck = async () => {
      request.signal.throwIfAborted();
      if (!(await waitForDeadline(ctx.authorize, request.signal))) {
        throw new Error("reasoning_authorization_revoked");
      }
    };
    try {
      const gate = await session.authorize({
        agentId: ctx.agentId,
        enterpriseId: ctx.tenantId,
        modelGateInput: {
          cfg: ctx.cfg,
          agentId: ctx.agentId,
          gatewayClientUser: ctx.client.user,
          gatewayClientSessionDomain: ctx.client.sessionDomain,
          enterpriseIdHint: ctx.tenantId,
          taskText: "Analyze observation evidence metadata",
          contextParts: host.model.buildRunContextEstimateParts({
            taskText: JSON.stringify(metadata),
            toolsKnown: true,
            toolsText: "",
            attachmentsKnown: true,
            attachmentsText: "",
            outputReserveTokens: 2048,
          }).contextParts,
        },
      });
      if (gate.acquired) {
        state.cleanupStatus = "pending";
      }
      await recheck();
      // A skipped personal gate is not evidence of authorized enterprise consumption.
      if (
        !gate.acquired ||
        gate.enterpriseId !== ctx.tenantId ||
        !gate.modelGate ||
        gate.modelGate.tenantId !== ctx.tenantId ||
        !gate.modelGate.allowlist?.length
      ) {
        throw new Error("reasoning_commercial_admission_denied");
      }
      session.prepareModelSet({
        config: ctx.cfg,
        actorId: "platform-user:" + ctx.client.platformUserId,
        routing: host.model.resolveExecutionRoutingFromCapabilityPlan({
          allowlist: gate.modelGate.allowlist,
          preferredModelOrder: gate.modelGate.preferredModelOrder,
          capabilityPlan: gate.modelGate.capabilityPlan,
        }),
      });
      const result = await waitForDeadline(
        () =>
          session.infer({
            cfg: ctx.cfg,
            authStoreReadOnly: true,
            provider: ref.provider,
            model: ref.model,
            agentDir: resolveAgentDir(ctx.cfg, ctx.agentId),
            signal: request.signal,
            fallbacksOverride: resolveRunModelFallbacksOverride({
              cfg: ctx.cfg,
              agentId: ctx.agentId,
            }),
            taskText: "Analyze observation evidence metadata",
            run: async (provider, candidateModel) => {
              await recheck();
              const candidate = await waitForDeadline(
                () =>
                  ports.candidate
                    ? ports.candidate(provider, candidateModel, request.signal)
                    : readCandidate(ctx, provider, candidateModel, request.signal),
                request.signal,
              );
              await recheck();
              state.usageStatus = "pending_reconciliation";
              reason("transport_usage_unconfirmed");
              const completed = await waitForDeadline(
                () =>
                  (ports.complete ?? invokeMetadataCompletion)({
                    ...candidate,
                    metadata,
                    modelRef: candidate.model.provider + "/" + candidate.model.id,
                    signal: request.signal,
                    maxTokens: 2048,
                  }),
                request.signal,
                async (late) => {
                  state.usageStatus = "late_usage_pending_reconciliation";
                  state.observedUsage = usageFromUnknown(late.response.usage);
                  reason("late_usage_pending_reconciliation");
                },
              );
              // Account the actual response even if JSON validation/revocation later rejects it.
              state.observedUsage = usageFromUnknown(completed.response.usage);
              state.usageStatus = "accounting_pending";
              const accounting = session.recordUsage({
                provider: candidate.model.provider,
                model: candidate.model.id,
                usage: completed.response.usage,
                agentId: ctx.agentId,
                creditUserId: ctx.client.platformUserId,
                toolCallCount: 0,
                toolClasses: [],
                fallbackAttemptsRaw: [],
              });
              await waitForDeadline(() => accounting, request.signal);
              state.usageStatus = "accounted";
              await recheck();
              return {
                completed,
                actualModelRef: candidate.model.provider + "/" + candidate.model.id,
              };
            },
          }),
        request.signal,
      );
      await recheck();
      return {
        value: result.result.completed.readValue(),
        actualModelRef: result.result.actualModelRef,
      };
    } finally {
      await session.dispose();
    }
  };
  return {
    modelRef,
    model: Object.assign(model, {
      settlesOnAbort: true as const,
      diagnostics: () => (diagnostics ? structuredClone(diagnostics) : undefined),
    }),
  };
}

/** Same default-off server composition used by the gateway and isolated tests. */
export function createObservationReasoningOptions(
  enabled = false,
  resolver = createReasoningModelResolver,
) {
  return { reasoning: { enabled }, reasoningResolver: resolver };
}
