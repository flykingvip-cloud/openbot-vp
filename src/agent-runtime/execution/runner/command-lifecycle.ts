import { runWithModelFallback } from "../../../agents/model-fallback.js";
import { createCommandAdmissionSession, type ModelInferenceInput } from "../../model/index.js";
import { createControlledExecutionUseCase } from "./controlled-execution.js";

/** Command authority adapter over the unique controlled execution use-case.
 * Preserves E2 (ingress) / E3 (CLI) / E6 (subagent) governance entry ports and
 * inherited child snapshots. Stage order is owned by createControlledExecutionUseCase;
 * this factory only supplies command commercial admission + fallback governance. */
export function createCommandExecutionLifecycle(
  params: Parameters<typeof createCommandAdmissionSession>[0],
) {
  const authority = createCommandAdmissionSession(params);
  return createControlledExecutionUseCase({
    async prepare(input: {
      authorization: Parameters<typeof authority.acquire>[0];
      signal?: AbortSignal;
    }) {
      input.signal?.throwIfAborted();
      const authorization = await authority.acquire(input.authorization);
      input.signal?.throwIfAborted();
      return authorization.status === "denied"
        ? { kind: "denied" as const, authorization, message: authorization.message }
        : { kind: "ready" as const, authorization };
    },
    infer<T>(input: ModelInferenceInput<T>) {
      return runWithModelFallback({
        cfg: input.cfg,
        provider: input.provider,
        model: input.model,
        agentDir: input.agentDir,
        fallbacksOverride: input.fallbacksOverride,
        runId: params.runId,
        runtimeAdmission: { taskText: input.taskText },
        ...(input.executorEvidence ? { executorEvidence: input.executorEvidence } : {}),
        ...authority.fallbackGovernance(),
        run: input.run,
      });
    },
    dispose() {
      return authority.dispose();
    },
  });
}
