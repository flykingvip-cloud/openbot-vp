import { runWithModelFallback } from "../../../agents/model-fallback.js";
import { createCommandAdmissionSession, type ModelInferenceInput } from "../../model/index.js";
import { createExecutionScope } from "./execution-scope.js";

/** Command authority adapter: preserves E2/E3/E6 and inherited child snapshots.
 * Stage order, readiness, cancellation and retry identity belong to the shared scope. */
export function createCommandExecutionLifecycle(
  params: Parameters<typeof createCommandAdmissionSession>[0],
) {
  const authority = createCommandAdmissionSession(params);
  return createExecutionScope({
    async prepare(input: {
      authorization: Parameters<typeof authority.acquire>[0];
      signal?: AbortSignal;
    }) {
      const authorization = await authority.acquire(input.authorization);
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
        ...authority.fallbackGovernance(),
        run: input.run,
      });
    },
    dispose() {
      return authority.dispose();
    },
  });
}
