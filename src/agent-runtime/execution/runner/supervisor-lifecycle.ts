import type { ModelInferenceInput } from "../../model/index.js";
import { createControlledExecutionUseCase } from "./controlled-execution.js";

export type SupervisorWorkItemAdmission =
  | { status: "acquired" }
  | { status: "skipped" }
  | { status: "denied"; message: string };

/**
 * Supervisor work-item authority adapter over the unique controlled execution
 * use-case. Scene hosts supply commercial acquire/release ports; stage order
 * stays here. Does not invent a second executor or scheduler.
 */
export function createSupervisorWorkItemLifecycle(ports: {
  acquire: (input: {
    runId: string;
    agentId?: string;
    enterpriseId?: string;
  }) => Promise<SupervisorWorkItemAdmission>;
  release: (runId: string) => Promise<void>;
}) {
  let heldRunId: string | undefined;
  return createControlledExecutionUseCase({
    async prepare(input: {
      runId: string;
      agentId?: string;
      enterpriseId?: string;
      signal?: AbortSignal;
    }) {
      input.signal?.throwIfAborted();
      const admission = await ports.acquire({
        runId: input.runId,
        agentId: input.agentId,
        enterpriseId: input.enterpriseId,
      });
      input.signal?.throwIfAborted();
      if (admission.status === "denied") {
        return { kind: "denied" as const, message: admission.message, admission };
      }
      if (admission.status === "acquired") {
        heldRunId = input.runId;
      }
      return { kind: "ready" as const, admission };
    },
    async infer<T>(input: ModelInferenceInput<T>) {
      // Work-item candidate (CLI / node). Single-shot; fallback chains are unused.
      const result = await input.run(input.provider, input.model);
      return {
        result,
        provider: input.provider,
        model: input.model,
        attempts: [],
      };
    },
    dispose() {
      const id = heldRunId;
      heldRunId = undefined;
      return id ? ports.release(id) : Promise.resolve();
    },
  });
}
