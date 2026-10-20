/**
 * M0 passive conversation evaluation.
 *
 * Subscribes to the in-process agent-event bus and appends evaluation rows under
 * `$CONFIG_DIR/conversation-evaluations/<tenantHash16>/<yyyy>/<mm>/<dd>/<runId>.jsonl`.
 * It does not call diagnose(), open confirm, or write diagnosis schedules,
 * projections, or evolution prescriptions.
 *
 * Enable with OPENBOT_CONVERSATION_EVALUATION=1. Default is off: no subscriber
 * and no evaluation I/O.
 */

export { isConversationEvaluationEnabled, CONVERSATION_EVALUATION_ENV } from "./feature.js";
export {
  A0_DROP_ALERT_RATE,
  A0_DROP_ALERT_WINDOW_MS,
  A0_LATENCY_MIN_SAMPLES,
  A0_LATENCY_WINDOW_MS,
  A0_P95_ABS_MS,
  A0_P95_RATIO,
  A0_P99_ABS_MS,
  A0_P99_RATIO,
  A0_QUEUE_MAX_BYTES,
  A0_QUEUE_MAX_ITEMS,
  A0_WRITE_TIMEOUT_MS,
  compareLatencyRegression,
  isDropRateAlert,
  PENDING_SLO_MS,
} from "./thresholds.js";
export {
  classifyEntrypoint,
  classifyLinkQuality,
  isDiagnosticReplayRunId,
  tenantHash16,
} from "./identity.js";
export { NON_STREAM_TTFT_ALGORITHM, deriveEfficiency } from "./efficiency.js";
export { EvaluationIdempotency, foldEvaluationRecords } from "./idempotency.js";
export { computeMetrics } from "./metrics.js";
export { CONVERSATION_EVALUATIONS_DIR, denominatorFilePath, evaluationFilePath } from "./store.js";
export {
  startConversationEvaluation,
  type ConversationEvaluationHandle,
  type DropCounts,
  type StartConversationEvaluationOptions,
} from "./pipeline.js";
export type { ObservationInput } from "./reducer.js";
export {
  CONVERSATION_EVALUATION_RULE_SET_ID,
  CONVERSATION_EVALUATION_RULE_VERSION,
  type ConversationEvaluationRecord,
} from "./types.js";
