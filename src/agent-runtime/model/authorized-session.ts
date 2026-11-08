/** Shared model authorization state. No task creation, scheduling, provider loop or delivery. */
import type { resolveEmbeddedModelGovernance } from "../../agents/embedded-model-governance.js";
import type { runWithModelFallback } from "../../agents/model-fallback.js";
import { normalizeUsage, type UsageLike } from "../../agents/usage.js";
import { buildCommercialRunCreditUsageInput } from "../../auto-reply/reply/agent-run-credit-usage.js";
import type { OpenBotConfig } from "../../config/config.js";
import type {
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
} from "../../gateway/billing/agent-run-governance.js";
import type { recordCreditUsage } from "../../gateway/billing/record-credit-usage.js";
import type {
  buildRunModelSetSnapshot,
  forgetRunModelSet,
  rememberRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../gateway/governance/spawn-snapshot-handoff.js";
import type { buildRunContextEstimateParts } from "../../gateway/model-entitlement/run-context-estimate.js";
import type { resolveExecutionRoutingFromCapabilityPlan } from "../../gateway/model-entitlement/task-capability-plan.js";
import type { resolvePlatformModelsMode } from "../../gateway/models/platform-models-config.js";
import { createRunAdmissionLease } from "./admission-lease.js";

export type ModelSessionPorts = {
  accounting: { recordCreditUsage: typeof recordCreditUsage };
  admission: {
    tryAcquireEnterpriseAgentRun: typeof tryAcquireEnterpriseAgentRun;
    releaseEnterpriseAgentRun: typeof releaseEnterpriseAgentRun;
  };
  model: {
    resolveEmbeddedModelGovernance: typeof resolveEmbeddedModelGovernance;
    buildRunModelSetSnapshot: typeof buildRunModelSetSnapshot;
    forgetRunModelSet: typeof forgetRunModelSet;
    rememberRunModelSet: typeof rememberRunModelSet;
    snapshotCreditReportingFromGate: typeof snapshotCreditReportingFromGate;
    resolvePlatformModelsMode: typeof resolvePlatformModelsMode;
    runWithModelFallback: typeof runWithModelFallback;
  };
};
export type InteractionPreparationPorts = {
  buildRunContextEstimateParts: typeof buildRunContextEstimateParts;
  resolveExecutionRoutingFromCapabilityPlan: typeof resolveExecutionRoutingFromCapabilityPlan;
};
type AdmissionResult = Awaited<ReturnType<typeof tryAcquireEnterpriseAgentRun>>;
type Acquired = Extract<AdmissionResult, { acquired: true }>;

export function createAuthorizedModelSession(runId: string, ports: ModelSessionPorts) {
  let admitted = false;
  let disposed = false;
  let acquired: Acquired | undefined;
  let prepared:
    | {
        governance: ReturnType<typeof resolveEmbeddedModelGovernance>;
        preferredModelOrder?: string[];
      }
    | undefined;
  const lease = createRunAdmissionLease({
    acquire: ports.admission.tryAcquireEnterpriseAgentRun,
    release: () => ports.admission.releaseEnterpriseAgentRun(runId),
    forgetSnapshot: () => {
      ports.model.forgetRunModelSet(runId);
    },
  });
  return {
    get held() {
      return lease.held;
    },
    get gate() {
      return acquired?.modelGate;
    },
    get billing() {
      return {
        authorizationDecisionId: acquired?.authorizationDecisionId,
        subscriptionId: acquired?.subscriptionId,
        planId: acquired?.planId,
        planVersionId: acquired?.planVersionId,
        subscriptionSnapshotId: acquired?.subscriptionSnapshotId,
      };
    },
    async authorize(
      input: Omit<Parameters<typeof tryAcquireEnterpriseAgentRun>[0], "runId">,
    ): Promise<AdmissionResult> {
      if (disposed) {
        throw new Error("Model session is disposed");
      }
      if (lease.held && acquired) {
        return acquired;
      }
      admitted = false;
      prepared = undefined;
      const result = await lease.acquire({ ...input, runId });
      admitted = result.acquired || result.skipped;
      if (result.acquired) {
        acquired = result;
      }
      return result;
    },
    prepareModelSet(input: {
      config: OpenBotConfig;
      actorId?: string;
      routing: ReturnType<typeof resolveExecutionRoutingFromCapabilityPlan>;
    }) {
      if (!admitted) {
        throw new Error("Model session has not been authorized");
      }
      const modelGate = acquired?.modelGate;
      const governance = ports.model.resolveEmbeddedModelGovernance({
        gateStatus: lease.held ? "acquired" : "skipped",
        allowlist: input.routing.allowlist,
        tenantId: modelGate?.tenantId,
        commercialAuthorizationId: acquired?.authorizationDecisionId,
        actorId: input.actorId,
      });
      const snapshot = ports.model.buildRunModelSetSnapshot({
        runId,
        allowlist: input.routing.allowlist,
        governanceMode: governance.governanceMode,
        commercialAuthorizationId: acquired?.authorizationDecisionId,
        tenantId: modelGate?.tenantId,
        actorId: input.actorId,
        preferredModelOrder: input.routing.preferredModelOrder,
        platformModelsMode:
          modelGate?.effectiveRouting?.mode ?? ports.model.resolvePlatformModelsMode(input.config),
        ...(modelGate?.effectiveRouting?.selectorStrategy
          ? { selectorStrategy: modelGate.effectiveRouting.selectorStrategy }
          : {}),
        creditReporting: lease.held
          ? ports.model.snapshotCreditReportingFromGate({
              modelGate,
              subscriptionId: acquired?.subscriptionId,
              subscriptionSnapshotId: acquired?.subscriptionSnapshotId,
              planId: acquired?.planId,
              planVersionId: acquired?.planVersionId,
            })
          : undefined,
      });
      if (snapshot) {
        ports.model.rememberRunModelSet(runId, snapshot);
      }
      prepared = { governance, preferredModelOrder: input.routing.preferredModelOrder };
      return governance;
    },
    async infer<T>(input: {
      cfg: OpenBotConfig;
      provider: string;
      model: string;
      agentDir?: string;
      fallbacksOverride?: string[];
      taskText: string;
      signal?: AbortSignal;
      run: Parameters<typeof runWithModelFallback<T>>[0]["run"];
    }) {
      if (!admitted || !prepared || disposed) {
        throw new Error("Model session is not prepared");
      }
      input.signal?.throwIfAborted();
      const result = await ports.model.runWithModelFallback({
        cfg: input.cfg,
        provider: input.provider,
        model: input.model,
        agentDir: input.agentDir,
        fallbacksOverride: input.fallbacksOverride,
        ...prepared.governance,
        ...(prepared.preferredModelOrder
          ? { preferredModelOrder: prepared.preferredModelOrder }
          : {}),
        runtimeAdmission: { taskText: input.taskText },
        runId,
        run: async (provider, model, options) => {
          input.signal?.throwIfAborted();
          const response = await input.run(provider, model, options);
          input.signal?.throwIfAborted();
          return response;
        },
      });
      input.signal?.throwIfAborted();
      return result;
    },
    recordUsage(input: {
      provider: string;
      model: string;
      usage?: UsageLike;
      creditUserId?: string;
      agentId?: string;
      durationMs?: number;
      toolCallCount: number;
      toolClasses: readonly string[];
      fallbackAttemptsRaw: unknown;
    }) {
      if (!admitted || disposed) {
        throw new Error("Model session has not been authorized");
      }
      const reporting = acquired?.modelGate?.creditReporting;
      if (!reporting) {
        return Promise.resolve(undefined);
      }
      return ports.accounting.recordCreditUsage(
        buildCommercialRunCreditUsageInput({
          enterpriseId: reporting.enterpriseId,
          policyId: reporting.policyId,
          runId,
          provider: input.provider,
          model: input.model,
          creditUserId: input.creditUserId,
          agentId: input.agentId,
          authorizationDecisionId: acquired?.authorizationDecisionId,
          subscriptionId: acquired?.subscriptionId,
          planId: acquired?.planId,
          planVersionId: acquired?.planVersionId,
          subscriptionSnapshotId: acquired?.subscriptionSnapshotId,
          durationMs: input.durationMs,
          toolCallCount: input.toolCallCount,
          toolClasses: input.toolClasses,
          fallbackAttemptsRaw: input.fallbackAttemptsRaw,
          tokenUsage: normalizeUsage(input.usage),
        }),
      );
    },
    dispose() {
      disposed = true;
      admitted = false;
      prepared = undefined;
      return lease.dispose();
    },
  };
}
