/**
 * Agent command (CLI / Gateway `agent` RPC) credit usage recording.
 *
 * Mirrors the auto-reply / followup / cron enterprise paths: a completed embedded run
 * under an acquired enterprise commercial slot writes one durable Credits usage record
 * (usage outbox → `recordCreditUsage` → reservation settle).
 *
 * Billing rule (see PR description; owner sign-off required):
 * - Only when the commercial gate returned `acquired` AND the model gate exposes
 *   `creditReporting` (enterprise scope with a plan version). `skipped` (no enterprise
 *   scope) and the subagent lane (gate never called; billing attribution deferred to P4,
 *   plan Q2) record nothing.
 * - CLI-backend providers never record Credits here: they bring their own credentials and
 *   are attributed by `recordCliBackendUsage` (same rule as cron `run.ts`), so a run is
 *   never counted twice.
 * - Runs with no non-zero token usage record nothing (same as followup / cron).
 * - Kill switch: `OPENBOT_AGENT_COMMAND_CREDIT_USAGE=0|false|no|off` disables recording.
 *   Unset or any other value keeps it ON.
 */

import { isCliProvider } from "../../agents/model-selection.js";
import { hasNonzeroUsage, normalizeUsage } from "../../agents/usage.js";
import { buildCommercialRunCreditUsageInput } from "../../auto-reply/reply/agent-run-credit-usage.js";
import type { OpenBotConfig } from "../../config/config.js";
import { drainUsageOutboxRecord } from "../../gateway/billing/usage-outbox-drain.js";
import { enqueueUsageOutbox } from "../../gateway/billing/usage-outbox-store.js";
import { parseBooleanValue } from "../../utils/boolean.js";
import type { AgentCommandCommercialGateResult } from "./commercial-run-gate.js";

export const AGENT_COMMAND_CREDIT_USAGE_ENV = "OPENBOT_AGENT_COMMAND_CREDIT_USAGE";

export type AgentCommandCreditUsageOutcome =
  | { status: "recorded"; taskId: string }
  | {
      status: "skipped";
      reason:
        | "disabled"
        | "no-commercial-gate"
        | "gate-not-acquired"
        | "no-credit-reporting"
        | "cli-backend"
        | "no-usage";
    }
  | { status: "failed"; taskId: string; error: string };

/** Default ON; only an explicit falsy value (0/false/no/off) disables recording. */
export function isAgentCommandCreditUsageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanValue(env[AGENT_COMMAND_CREDIT_USAGE_ENV]) !== false;
}

/**
 * Idempotency key for the usage record. The outbox dedupes on taskId, so a run id that
 * silently falls back to the session id (CLI invocations without `--run-id`) would make
 * every later turn of that session a no-op. In that case derive a per-execution key.
 */
export function resolveAgentCommandCreditTaskId(params: {
  runId: string;
  sessionId: string;
  startedAt: number;
}): string {
  if (params.runId && params.runId !== params.sessionId) {
    return params.runId;
  }
  return `agent-credit:${params.sessionId}:${params.startedAt}`;
}

type AgentRunResultLike = {
  meta?: {
    durationMs?: number;
    agentMeta?: { usage?: Parameters<typeof normalizeUsage>[0] };
  };
};

export type RecordAgentCommandCreditUsageParams = {
  gate: AgentCommandCommercialGateResult | undefined;
  cfg: OpenBotConfig;
  runId: string;
  sessionId: string;
  startedAt: number;
  /** Provider / model that actually produced the result (post-fallback). */
  provider: string;
  model: string;
  agentId: string;
  /** Trusted, gateway-authenticated client user (never taken from RPC params). */
  creditUserId?: string;
  result: AgentRunResultLike;
  fallbackAttempts: unknown;
  env?: NodeJS.ProcessEnv;
  onError?: (message: string) => void;
};

export async function recordAgentCommandCreditUsage(
  params: RecordAgentCommandCreditUsageParams,
): Promise<AgentCommandCreditUsageOutcome> {
  if (!isAgentCommandCreditUsageEnabled(params.env)) {
    return { status: "skipped", reason: "disabled" };
  }
  const gate = params.gate;
  if (!gate) {
    return { status: "skipped", reason: "no-commercial-gate" };
  }
  if (gate.status !== "acquired") {
    return { status: "skipped", reason: "gate-not-acquired" };
  }
  const creditReporting = gate.modelGate?.creditReporting;
  if (!creditReporting) {
    return { status: "skipped", reason: "no-credit-reporting" };
  }
  if (isCliProvider(params.provider, params.cfg)) {
    return { status: "skipped", reason: "cli-backend" };
  }
  const rawUsage = params.result.meta?.agentMeta?.usage;
  if (!hasNonzeroUsage(normalizeUsage(rawUsage))) {
    return { status: "skipped", reason: "no-usage" };
  }
  const tokenUsage = normalizeUsage(rawUsage);
  const taskId = resolveAgentCommandCreditTaskId(params);
  const creditUserId = params.creditUserId?.trim() || undefined;
  try {
    const payload = buildCommercialRunCreditUsageInput({
      enterpriseId: creditReporting.enterpriseId,
      policyId: creditReporting.policyId,
      runId: taskId,
      provider: params.provider,
      model: params.model,
      ...(creditUserId ? { creditUserId } : {}),
      agentId: params.agentId,
      authorizationDecisionId: gate.authorizationDecisionId,
      subscriptionId: gate.subscriptionId,
      planId: gate.planId,
      planVersionId: gate.planVersionId,
      subscriptionSnapshotId: gate.subscriptionSnapshotId,
      durationMs: params.result.meta?.durationMs,
      toolCallCount: 0,
      toolClasses: [],
      fallbackAttemptsRaw: params.fallbackAttempts,
      tokenUsage,
    });
    const receipt = await enqueueUsageOutbox(payload);
    // The outbox record is durable; a failed drain is retried by the outbox drainer.
    await drainUsageOutboxRecord(receipt).catch((err) => {
      params.onError?.(`agent credit usage drain deferred: ${String(err)}`);
    });
    return { status: "recorded", taskId };
  } catch (err) {
    const message = String(err);
    params.onError?.(`agent credit usage outbox enqueue failed: ${message}`);
    return { status: "failed", taskId, error: message };
  }
}
