import type { AdmittedTurnHost } from "./admitted-turn-host.js";
import { createUnifiedExecutionLifecycle } from "./unified-lifecycle.js";

type Host = Pick<AdmittedTurnHost, "admission" | "model" | "accounting">;

/** @deprecated Use `createUnifiedExecutionLifecycle({ mode: "turn", runId, host })`. */
export function createExecutionLifecycle(runId: string, host: Host) {
  return createUnifiedExecutionLifecycle({ mode: "turn", runId, host });
}
