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
import { ContractEndedError } from "../../gateway/billing/billing-period.js";
import type { recordCreditUsage } from "../../gateway/billing/record-credit-usage.js";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import type {
  buildRunModelSetSnapshot,
  forgetRunModelSet,
  rememberRunModelSet,
  snapshotCreditReportingFromGate,
} from "../../gateway/governance/spawn-snapshot-handoff.js";
import type { EmployeeModelGateResult } from "../../gateway/model-entitlement/employee-model-gate.js";
import type { buildRunContextEstimateParts } from "../../gateway/model-entitlement/run-context-estimate.js";
import type { resolveExecutionRoutingFromCapabilityPlan } from "../../gateway/model-entitlement/task-capability-plan.js";
import type { resolvePlatformModelsMode } from "../../gateway/models/platform-models-config.js";
import type { AgentCommandGovernanceEntry } from "../contracts/command.js";
import { createRunAdmissionLease } from "./admission-lease.js";
import type {
  acquireAgentCommandCommercialRun,
  AgentCommandCommercialGateResult,
  releaseAgentCommandCommercialRun,
} from "./command-commercial-gate.js";
import type { resolveAgentCommandModelGovernance } from "./command-governance.js";

const CONTRACT_ENDED_MESSAGE = "当前服务合同已结束，本次执行未获准入。请联系管理员续订后重试。";

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

export type CommandModelSessionPorts = {
  accounting: { recordCreditUsage: typeof recordCreditUsage };
  admission: {
    acquireAgentCommandCommercialRun: typeof acquireAgentCommandCommercialRun;
    releaseAgentCommandCommercialRun: typeof releaseAgentCommandCommercialRun;
  };
  model: {
    resolveAgentCommandModelGovernance: typeof resolveAgentCommandModelGovernance;
    resolveExecutionRoutingFromCapabilityPlan: typeof resolveExecutionRoutingFromCapabilityPlan;
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
type CommandAcquired = Extract<AgentCommandCommercialGateResult, { status: "acquired" }>;
export type ModelInferenceInput<T> = {
  cfg: OpenBotConfig;
  provider: string;
  model: string;
  agentDir?: string;
  fallbacksOverride?: string[];
  taskText: string;
  authStoreReadOnly?: boolean;
  signal?: AbortSignal;
  /** External single-shot execution (e.g., ACP or supervisor worker); skips model fallback loop. */
  singleShot?: boolean;
  /** When set, each fallback candidate records model-call evidence before `run`. */
  executorEvidence?: Parameters<typeof runWithModelFallback<T>>[0]["executorEvidence"];
  run: Parameters<typeof runWithModelFallback<T>>[0]["run"];
};
export type ModelInferenceResult<T> = Awaited<ReturnType<typeof runWithModelFallback<T>>>;
export type SessionUsageRecordInput = {
  provider: string;
  model: string;
  usage?: UsageLike;
  creditUserId?: string;
  agentId?: string;
  durationMs?: number;
  toolCallCount: number;
  toolClasses: readonly string[];
  fallbackAttemptsRaw: unknown;
};

type SnapshotModelPorts = Pick<
  ModelSessionPorts["model"],
  | "buildRunModelSetSnapshot"
  | "rememberRunModelSet"
  | "snapshotCreditReportingFromGate"
  | "resolvePlatformModelsMode"
>;

function rememberSessionModelSetSnapshot(params: {
  runId: string;
  config: OpenBotConfig;
  allowlist?: string[];
  governanceMode?: ReturnType<typeof resolveEmbeddedModelGovernance>["governanceMode"];
  commercialAuthorizationId?: string;
  tenantId?: string;
  actorId?: string;
  preferredModelOrder?: string[];
  modelGate?: EmployeeModelGateResult;
  creditHeld: boolean;
  subscriptionId?: string;
  subscriptionSnapshotId?: string;
  planId?: string;
  planVersionId?: string;
  ports: SnapshotModelPorts;
}): void {
  const snapshot = params.ports.buildRunModelSetSnapshot({
    runId: params.runId,
    allowlist: params.allowlist,
    governanceMode: params.governanceMode,
    commercialAuthorizationId: params.commercialAuthorizationId,
    tenantId: params.tenantId,
    actorId: params.actorId,
    preferredModelOrder: params.preferredModelOrder,
    platformModelsMode:
      params.modelGate?.effectiveRouting?.mode ??
      params.ports.resolvePlatformModelsMode(params.config),
    ...(params.modelGate?.effectiveRouting?.selectorStrategy
      ? { selectorStrategy: params.modelGate.effectiveRouting.selectorStrategy }
      : {}),
    creditReporting: params.creditHeld
      ? params.ports.snapshotCreditReportingFromGate({
          modelGate: params.modelGate,
          subscriptionId: params.subscriptionId,
          subscriptionSnapshotId: params.subscriptionSnapshotId,
          planId: params.planId,
          planVersionId: params.planVersionId,
        })
      : undefined,
  });
  if (snapshot) {
    params.ports.rememberRunModelSet(params.runId, snapshot);
  }
}

async function runSessionModelFallback<T>(params: {
  runId: string;
  input: ModelInferenceInput<T>;
  governance: Record<string, unknown>;
  preferredModelOrder?: string[];
  runWithModelFallback: typeof runWithModelFallback;
}): Promise<ModelInferenceResult<T>> {
  const { input } = params;
  input.signal?.throwIfAborted();
  const result = await params.runWithModelFallback({
    cfg: input.cfg,
    authStoreReadOnly: input.authStoreReadOnly,
    provider: input.provider,
    model: input.model,
    agentDir: input.agentDir,
    fallbacksOverride: input.fallbacksOverride,
    ...(input.executorEvidence ? { executorEvidence: input.executorEvidence } : {}),
    ...params.governance,
    ...(params.preferredModelOrder ? { preferredModelOrder: params.preferredModelOrder } : {}),
    runtimeAdmission: { taskText: input.taskText },
    runId: params.runId,
    run: async (provider, model, options) => {
      input.signal?.throwIfAborted();
      const response = await input.run(provider, model, options);
      input.signal?.throwIfAborted();
      return response;
    },
  });
  input.signal?.throwIfAborted();
  return result;
}

function recordSessionCreditUsage(params: {
  runId: string;
  input: SessionUsageRecordInput;
  admitted: boolean;
  disposed: boolean;
  usageSettled: boolean;
  markSettled: () => void;
  acquired?: {
    modelGate?: EmployeeModelGateResult;
    authorizationDecisionId?: string;
    subscriptionId?: string;
    planId?: string;
    planVersionId?: string;
    subscriptionSnapshotId?: string;
  };
  recordCreditUsage: typeof recordCreditUsage;
}) {
  const reporting = params.acquired?.modelGate?.creditReporting;
  if (!reporting) {
    if (!params.admitted && !params.acquired) {
      throw new Error("Model session has not been authorized");
    }
    return Promise.resolve(undefined);
  }
  // A late settlement after the visible receipt may still persist usage
  // via the existing accounting path. A second call after dispose must not.
  if (params.disposed && params.usageSettled) {
    throw new Error("Model session has not been authorized");
  }
  return Promise.resolve(
    params.recordCreditUsage(
      buildCommercialRunCreditUsageInput({
        enterpriseId: reporting.enterpriseId,
        policyId: reporting.policyId,
        runId: params.runId,
        provider: params.input.provider,
        model: params.input.model,
        creditUserId: params.input.creditUserId,
        agentId: params.input.agentId,
        authorizationDecisionId: params.acquired?.authorizationDecisionId,
        subscriptionId: params.acquired?.subscriptionId,
        planId: params.acquired?.planId,
        planVersionId: params.acquired?.planVersionId,
        subscriptionSnapshotId: params.acquired?.subscriptionSnapshotId,
        durationMs: params.input.durationMs,
        toolCallCount: params.input.toolCallCount,
        toolClasses: params.input.toolClasses,
        fallbackAttemptsRaw: params.input.fallbackAttemptsRaw,
        tokenUsage: normalizeUsage(params.input.usage),
      }),
    ),
  ).finally(() => {
    params.markSettled();
  });
}

export function createAuthorizedModelSession(runId: string, ports: ModelSessionPorts) {
  let admitted = false;
  let disposed = false;
  let usageSettled = false;
  let acquired: Acquired | undefined;
  let prepared:
    | {
        governance: ReturnType<typeof resolveEmbeddedModelGovernance>;
        preferredModelOrder?: string[];
      }
    | undefined;
  const lease = createRunAdmissionLease({
    acquire: async (input): Promise<AdmissionResult> => {
      try {
        return await ports.admission.tryAcquireEnterpriseAgentRun(input);
      } catch (error) {
        if (!(error instanceof ContractEndedError)) {
          throw error;
        }
        return {
          acquired: false,
          skipped: false,
          reason: "CONTRACT_ENDED",
          message: CONTRACT_ENDED_MESSAGE,
        };
      }
    },
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
      rememberSessionModelSetSnapshot({
        runId,
        config: input.config,
        allowlist: input.routing.allowlist,
        governanceMode: governance.governanceMode,
        commercialAuthorizationId: acquired?.authorizationDecisionId,
        tenantId: modelGate?.tenantId,
        actorId: input.actorId,
        preferredModelOrder: input.routing.preferredModelOrder,
        modelGate,
        creditHeld: lease.held,
        subscriptionId: acquired?.subscriptionId,
        subscriptionSnapshotId: acquired?.subscriptionSnapshotId,
        planId: acquired?.planId,
        planVersionId: acquired?.planVersionId,
        ports: ports.model,
      });
      prepared = { governance, preferredModelOrder: input.routing.preferredModelOrder };
      return governance;
    },
    assertPrepared() {
      if (!admitted || !prepared || disposed) {
        throw new Error("Model session is not prepared");
      }
    },
    infer<T>(input: ModelInferenceInput<T>) {
      if (!admitted || !prepared || disposed) {
        return Promise.reject(new Error("Model session is not prepared"));
      }
      return runSessionModelFallback({
        runId,
        input,
        governance: prepared.governance,
        preferredModelOrder: prepared.preferredModelOrder,
        runWithModelFallback: ports.model.runWithModelFallback,
      });
    },
    recordUsage(input: SessionUsageRecordInput) {
      return recordSessionCreditUsage({
        runId,
        input,
        admitted,
        disposed,
        usageSettled,
        markSettled: () => {
          usageSettled = true;
        },
        acquired,
        recordCreditUsage: ports.accounting.recordCreditUsage,
      });
    },
    dispose() {
      disposed = true;
      admitted = false;
      prepared = undefined;
      return lease.dispose();
    },
  };
}

/** Command admission session built on the unified model-session state machine and single fallback call site. */
export function createCommandModelSession(
  params: {
    runId: string;
    isSubagentLane: boolean;
    identity?: ExecutionIdentityContext;
    entry?: AgentCommandGovernanceEntry;
    config?: OpenBotConfig;
  },
  ports: CommandModelSessionPorts,
) {
  let admitted = false;
  let disposed = false;
  let usageSettled = false;
  let gate: AgentCommandCommercialGateResult | undefined;
  let acquired: CommandAcquired | undefined;
  let routing: ReturnType<typeof resolveExecutionRoutingFromCapabilityPlan> | undefined;
  const lease = createRunAdmissionLease({
    acquire: async (
      input: Parameters<typeof acquireAgentCommandCommercialRun>[0],
    ): Promise<{ acquired: boolean; gate: AgentCommandCommercialGateResult }> => {
      let result: AgentCommandCommercialGateResult;
      try {
        result = await ports.admission.acquireAgentCommandCommercialRun(input);
      } catch (error) {
        // A known commercial refusal is not a provider failure or a held lease.
        if (!(error instanceof ContractEndedError)) {
          throw error;
        }
        result = {
          status: "denied",
          message: CONTRACT_ENDED_MESSAGE,
        };
      }
      return { acquired: result.status === "acquired", gate: result };
    },
    release: () => ports.admission.releaseAgentCommandCommercialRun(params.runId),
    forgetSnapshot: () => ports.model.forgetRunModelSet(params.runId),
  });

  const buildFallbackGovernance = () => ({
    ...ports.model.resolveAgentCommandModelGovernance(
      params.isSubagentLane ? undefined : gate,
      process.env,
      params.identity,
      params.entry,
    ),
    ...(routing?.allowlist !== undefined ? { entitlementAllowlist: routing.allowlist } : {}),
    ...(routing?.preferredModelOrder ? { preferredModelOrder: routing.preferredModelOrder } : {}),
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
    async acquire(input: Parameters<typeof acquireAgentCommandCommercialRun>[0]) {
      if (disposed) {
        throw new Error("Model session is disposed");
      }
      if (lease.held && gate && gate.status === "acquired") {
        return gate;
      }
      admitted = false;
      routing = undefined;
      gate = (await lease.acquire(input)).gate;
      if (gate.status === "denied") {
        acquired = undefined;
        return gate;
      }
      admitted = true;
      if (gate.status === "acquired") {
        acquired = gate;
        if (!params.isSubagentLane) {
          const governance = ports.model.resolveAgentCommandModelGovernance(
            gate,
            process.env,
            params.identity,
          );
          routing = ports.model.resolveExecutionRoutingFromCapabilityPlan({
            allowlist: governance.entitlementAllowlist,
            preferredModelOrder: gate.modelGate?.preferredModelOrder,
            capabilityPlan: gate.modelGate?.capabilityPlan,
          });
          rememberSessionModelSetSnapshot({
            runId: params.runId,
            config: params.config ?? {},
            allowlist: routing.allowlist,
            governanceMode: governance.governanceMode,
            commercialAuthorizationId: governance.governanceContext?.commercialAuthorizationId,
            tenantId: governance.governanceContext?.tenantId,
            actorId: governance.governanceContext?.actorId,
            preferredModelOrder: routing.preferredModelOrder,
            modelGate: gate.modelGate,
            creditHeld: true,
            subscriptionId: gate.subscriptionId,
            subscriptionSnapshotId: gate.subscriptionSnapshotId,
            planId: gate.planId,
            planVersionId: gate.planVersionId,
            ports: ports.model,
          });
        }
      } else {
        acquired = undefined;
      }
      return gate;
    },
    fallbackGovernance() {
      return buildFallbackGovernance();
    },
    assertPrepared() {
      if (!admitted || disposed) {
        throw new Error("Model session is not prepared");
      }
    },
    infer<T>(input: ModelInferenceInput<T>) {
      if (!admitted || disposed) {
        return Promise.reject(new Error("Model session is not prepared"));
      }
      const governance = buildFallbackGovernance();
      return runSessionModelFallback({
        runId: params.runId,
        input,
        governance,
        preferredModelOrder: governance.preferredModelOrder,
        runWithModelFallback: ports.model.runWithModelFallback,
      });
    },
    recordUsage(input: SessionUsageRecordInput) {
      if (params.isSubagentLane) {
        if (!admitted && !acquired) {
          throw new Error("Model session has not been authorized");
        }
        return Promise.resolve(undefined);
      }
      return recordSessionCreditUsage({
        runId: params.runId,
        input,
        admitted,
        disposed,
        usageSettled,
        markSettled: () => {
          usageSettled = true;
        },
        acquired,
        recordCreditUsage: ports.accounting.recordCreditUsage,
      });
    },
    dispose() {
      disposed = true;
      admitted = false;
      routing = undefined;
      return lease.dispose();
    },
  };
}
