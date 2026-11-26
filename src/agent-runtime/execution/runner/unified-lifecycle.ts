import { runWithModelFallback } from "../../../agents/model-fallback.js";
import type { OpenBotConfig } from "../../../config/config.js";
import {
  createAuthorizedModelSession,
  createCommandAdmissionSession,
  resolveAuxiliaryModelGovernance,
  type AuxiliaryModelPurpose,
  type ModelInferenceInput,
  type ModelInferenceResult,
  type ModelSessionPorts,
  type SessionUsageRecordInput,
} from "../../model/index.js";
import type { AdmittedTurnHost } from "./admitted-turn-host.js";
import { createControlledExecutionUseCase } from "./controlled-execution.js";
import type { RunEmbeddedPiAgentParams } from "./embedded-request.js";
import { runEmbeddedPiAgent } from "./embedded-run.js";
import type { ExecutionInferenceInput } from "./execution-scope.js";

type TurnSession = ReturnType<typeof createAuthorizedModelSession>;
type CommandSession = ReturnType<typeof createCommandAdmissionSession>;
type TurnHost = Pick<AdmittedTurnHost, "admission" | "model" | "accounting">;

export type SupervisorWorkItemAdmission =
  | { status: "acquired" }
  | { status: "skipped" }
  | { status: "denied"; message: string };

export type SupervisorWorkItemLifecyclePorts = {
  acquire: (input: {
    runId: string;
    agentId?: string;
    enterpriseId?: string;
  }) => Promise<SupervisorWorkItemAdmission>;
  release: (runId: string) => Promise<void>;
  recordUsage?: (input: SessionUsageRecordInput) => Promise<unknown>;
};

export type UnifiedTurnLifecycleOptions = {
  mode: "turn";
  runId: string;
  host: TurnHost;
};

export type UnifiedCommandLifecycleOptions = {
  mode: "command";
} & Parameters<typeof createCommandAdmissionSession>[0];

export type UnifiedWorkItemLifecycleOptions = {
  mode: "work_item";
  ports: SupervisorWorkItemLifecyclePorts;
};

export type UnifiedAuxiliaryLifecycleOptions = {
  mode: "auxiliary";
  runId: string;
  purpose: AuxiliaryModelPurpose | "extension";
  parentRunId?: string;
  env?: NodeJS.ProcessEnv;
};

export type UnifiedExecutionLifecycleOptions =
  | UnifiedTurnLifecycleOptions
  | UnifiedCommandLifecycleOptions
  | UnifiedWorkItemLifecycleOptions
  | UnifiedAuxiliaryLifecycleOptions;

async function runSingleShotInference<T>(
  input: ModelInferenceInput<T>,
): Promise<ModelInferenceResult<T>> {
  input.signal?.throwIfAborted();
  const result = await input.run(input.provider, input.model);
  input.signal?.throwIfAborted();
  return {
    result,
    provider: input.provider,
    model: input.model,
    attempts: [],
  };
}

function createTurnLifecycle(options: UnifiedTurnLifecycleOptions) {
  const session = createAuthorizedModelSession(options.runId, options.host);
  const scope = createControlledExecutionUseCase({
    async prepare(input: {
      config: OpenBotConfig;
      authorization: Parameters<TurnSession["authorize"]>[0];
      actorId?: string;
      signal?: AbortSignal;
    }) {
      input.signal?.throwIfAborted();
      const admission = await session.authorize(input.authorization);
      input.signal?.throwIfAborted();
      if (!admission.acquired && !admission.skipped) {
        return { kind: "denied" as const, message: admission.message };
      }
      const gate = session.gate;
      const routing = options.host.model.resolveExecutionRoutingFromCapabilityPlan({
        allowlist: gate?.allowlist,
        preferredModelOrder: gate?.preferredModelOrder,
        capabilityPlan: gate?.capabilityPlan,
      });
      const capability = options.host.model.consumeCapabilityRoutingResult({
        planFailure: routing.planFailure,
        outcomeClaim: routing.outcomeClaim,
        executionSurface: routing.executionSurface,
        capabilityPlan: routing.capabilityPlan,
      });
      if (routing.planFailure.kind === "no_executable_candidates") {
        return {
          kind: "unavailable" as const,
          gate,
          capability,
          message: routing.planFailure.message,
        };
      }
      session.prepareModelSet({ config: input.config, actorId: input.actorId, routing });
      input.signal?.throwIfAborted();
      return { kind: "ready" as const, gate, capability };
    },
    infer<T>(input: ModelInferenceInput<T>) {
      return session.infer(input);
    },
    dispose() {
      return session.dispose();
    },
  });
  return {
    ...scope,
    recordUsage(input: SessionUsageRecordInput) {
      return session.recordUsage(input);
    },
  };
}

function createCommandLifecycle(options: UnifiedCommandLifecycleOptions) {
  const { mode: _mode, ...params } = options;
  const session: CommandSession = createCommandAdmissionSession(params, { runWithModelFallback });
  const scope = createControlledExecutionUseCase({
    async prepare(input: {
      authorization: Parameters<CommandSession["acquire"]>[0];
      signal?: AbortSignal;
    }) {
      input.signal?.throwIfAborted();
      const authorization = await session.acquire(input.authorization);
      input.signal?.throwIfAborted();
      return authorization.status === "denied"
        ? { kind: "denied" as const, authorization, message: authorization.message }
        : { kind: "ready" as const, authorization };
    },
    infer<T>(input: ModelInferenceInput<T>) {
      if (input.singleShot) {
        session.assertPrepared();
        return runSingleShotInference(input);
      }
      return session.infer(input);
    },
    dispose() {
      return session.dispose();
    },
  });
  return {
    ...scope,
    recordUsage(input: SessionUsageRecordInput) {
      return session.recordUsage(input);
    },
  };
}

function createWorkItemLifecycle(options: UnifiedWorkItemLifecycleOptions) {
  let heldRunId: string | undefined;
  const scope = createControlledExecutionUseCase({
    async prepare(input: {
      runId: string;
      agentId?: string;
      enterpriseId?: string;
      signal?: AbortSignal;
    }) {
      input.signal?.throwIfAborted();
      const admission = await options.ports.acquire({
        runId: input.runId,
        agentId: input.agentId,
        enterpriseId: input.enterpriseId,
      });
      // Register release identity before the post-acquire cancel check so a
      // cancel that races the wait still lets dispose() free an acquired lease.
      if (admission.status === "acquired") {
        heldRunId = input.runId;
      }
      input.signal?.throwIfAborted();
      if (admission.status === "denied") {
        return { kind: "denied" as const, message: admission.message, admission };
      }
      return { kind: "ready" as const, admission };
    },
    infer<T>(input: ModelInferenceInput<T>) {
      return runSingleShotInference(input);
    },
    dispose() {
      const id = heldRunId;
      heldRunId = undefined;
      return id ? options.ports.release(id) : Promise.resolve();
    },
  });
  return {
    ...scope,
    recordUsage(input: SessionUsageRecordInput) {
      return options.ports.recordUsage
        ? Promise.resolve(options.ports.recordUsage(input))
        : Promise.resolve(undefined);
    },
  };
}

function createAuxiliaryLifecycle(options: UnifiedAuxiliaryLifecycleOptions) {
  const ports: ModelSessionPorts = {
    accounting: {
      recordCreditUsage: async () => undefined as never,
    },
    admission: {
      tryAcquireEnterpriseAgentRun: async () => ({ acquired: false, skipped: true }),
      releaseEnterpriseAgentRun: async () => {},
    },
    model: {
      resolveEmbeddedModelGovernance: (() => {
        if (options.purpose === "extension") {
          return {
            governanceMode: "legacy" as const,
            governanceContext: { purpose: "extension" },
          };
        }
        return resolveAuxiliaryModelGovernance({
          purpose: options.purpose,
          parentRunId: options.parentRunId,
          env: options.env,
        });
      }) as unknown as ModelSessionPorts["model"]["resolveEmbeddedModelGovernance"],
      buildRunModelSetSnapshot: () => undefined,
      forgetRunModelSet: () => {},
      rememberRunModelSet: () => {},
      snapshotCreditReportingFromGate: () => undefined,
      resolvePlatformModelsMode: () => "native",
      runWithModelFallback,
    },
  };
  const session = createAuthorizedModelSession(options.runId, ports);
  const scope = createControlledExecutionUseCase({
    async prepare(input: { config: OpenBotConfig; signal?: AbortSignal }) {
      input.signal?.throwIfAborted();
      await session.authorize({});
      input.signal?.throwIfAborted();
      const governance = session.prepareModelSet({
        config: input.config,
        routing: {
          allowlist: undefined,
          preferredModelOrder: undefined,
        } as unknown as Parameters<TurnSession["prepareModelSet"]>[0]["routing"],
      });
      input.signal?.throwIfAborted();
      return { kind: "ready" as const, governance };
    },
    infer<T>(input: ModelInferenceInput<T>) {
      if (input.singleShot) {
        session.assertPrepared();
        return runSingleShotInference(input);
      }
      return session.infer(input);
    },
    dispose() {
      return session.dispose();
    },
  });
  return {
    ...scope,
    recordUsage(input: SessionUsageRecordInput) {
      return session.recordUsage(input);
    },
  };
}

export type UnifiedTurnExecutionLifecycle = ReturnType<typeof createTurnLifecycle>;
export type UnifiedCommandExecutionLifecycle = ReturnType<typeof createCommandLifecycle>;
export type UnifiedWorkItemExecutionLifecycle = ReturnType<typeof createWorkItemLifecycle>;
export type UnifiedAuxiliaryExecutionLifecycle = ReturnType<typeof createAuxiliaryLifecycle>;
export type UnifiedExecutionLifecycle<
  M extends UnifiedExecutionLifecycleOptions["mode"] = UnifiedExecutionLifecycleOptions["mode"],
> = M extends "turn"
  ? UnifiedTurnExecutionLifecycle
  : M extends "command"
    ? UnifiedCommandExecutionLifecycle
    : M extends "work_item"
      ? UnifiedWorkItemExecutionLifecycle
      : UnifiedAuxiliaryExecutionLifecycle;

/**
 * Single controlled-execution lifecycle factory across turn (chat/cron/followup),
 * command (CLI/gateway/subagent/ACP), work_item (supervisor), and auxiliary
 * (memory_flush/slug_filename/extension) scenes.
 * All modes share the frozen `createControlledExecutionUseCase` stage order,
 * AbortSignal propagation, and single-dispose lease safety.
 */
export function createUnifiedExecutionLifecycle(
  options: UnifiedTurnLifecycleOptions,
): UnifiedTurnExecutionLifecycle;
export function createUnifiedExecutionLifecycle(
  options: UnifiedCommandLifecycleOptions,
): UnifiedCommandExecutionLifecycle;
export function createUnifiedExecutionLifecycle(
  options: UnifiedWorkItemLifecycleOptions,
): UnifiedWorkItemExecutionLifecycle;
export function createUnifiedExecutionLifecycle(
  options: UnifiedAuxiliaryLifecycleOptions,
): UnifiedAuxiliaryExecutionLifecycle;
export function createUnifiedExecutionLifecycle(options: UnifiedExecutionLifecycleOptions) {
  switch (options.mode) {
    case "turn":
      return createTurnLifecycle(options);
    case "command":
      return createCommandLifecycle(options);
    case "work_item":
      return createWorkItemLifecycle(options);
    case "auxiliary":
      return createAuxiliaryLifecycle(options);
  }
}

export async function runControlledAuxiliaryTurn(params: RunEmbeddedPiAgentParams) {
  const lifecycle = createUnifiedExecutionLifecycle({
    mode: "auxiliary",
    runId: params.runId,
    purpose: "extension",
  });
  try {
    await lifecycle.prepare({
      config: params.config ?? {},
      signal: params.abortSignal,
    });
    const outcome = await lifecycle.infer({
      cfg: params.config ?? {},
      provider: params.provider ?? "",
      model: params.model ?? "",
      agentDir: params.agentDir,
      taskText: params.prompt,
      signal: params.abortSignal,
      singleShot: true,
      run: async () => runEmbeddedPiAgent(params),
    });
    return outcome.result;
  } finally {
    await lifecycle.dispose();
  }
}

export type { ExecutionInferenceInput };
