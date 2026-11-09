/** Compatibility facade; all callers share the runtime-owned active-run registry. */
export {
  abortEmbeddedPiRun,
  clearActiveEmbeddedRun,
  getActiveEmbeddedRunCount,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  setActiveEmbeddedRun,
  waitForActiveEmbeddedRuns,
  waitForEmbeddedPiRunEnd,
  __testing,
} from "../../agent-runtime/execution/runner/run-registry.js";
export type { EmbeddedPiQueueHandle } from "../../agent-runtime/execution/runner/run-registry.js";
