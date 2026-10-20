/**
 * Subagent run credit usage (governance closure P4-1). Default OFF.
 *
 * The subagent lane never acquires a commercial run or a concurrency slot, and
 * `recordAgentCommandCreditUsage` keeps returning `skipped` / `no-commercial-gate` for
 * it. After a finished subagent run this module either:
 *
 *  - bills the run against the parent's authorization, only when
 *    `OPENBOT_SUBAGENT_CREDIT_USAGE` is truthy (1 / true / yes / on) in the process
 *    environment, the provider is not a CLI backend, the run reported non-zero token
 *    usage, and the parent snapshot carries `commercialAuthorizationId` plus
 *    `creditReporting.enterpriseId` and `policyId`. The existing
 *    `buildCommercialRunCreditUsageInput` payload goes to `enqueueUsageOutbox`, which is
 *    idempotent on taskId (the child run id), so the same child run is never charged
 *    twice. The gateway maintenance loop drains the outbox. No
 *    `subagent-usage-not-billed` envelope is written after a successful enqueue.
 *  - or writes the P4-0 shadow envelope (never billed). With the switch off this is
 *    exactly the P4-0 behavior. Switch on without enterprise / policy on the snapshot:
 *    `subagent-billing-context-absent` when the parent id is present, otherwise
 *    `missing-parent-authorization`.
 *
 * Billing context comes only from the in-process parent snapshot
 * (`opts.spawnGovernanceSnapshot`), never from RPC params. No gate is created,
 * `acquireAgentCommandCommercialRun` is never called, and no pre-deduction or
 * concurrency slot is taken. Failures are reported through `onError`, never thrown.
 */

import { isCliProvider } from "../../agents/model-selection.js";
import { hasNonzeroUsage, normalizeUsage, type UsageLike } from "../../agents/usage.js";
import { buildCommercialRunCreditUsageInput } from "../../auto-reply/reply/agent-run-credit-usage.js";
import type { OpenBotConfig } from "../../config/config.js";
import { enqueueUsageOutbox } from "../../gateway/billing/usage-outbox-store.js";
import type { RunGovernanceSnapshot } from "../../gateway/governance/decision.js";
import {
  recordSubagentUsageAttributionShadow,
  SUBAGENT_BILLING_CONTEXT_ABSENT_REASON,
} from "../../gateway/governance/subagent-usage-shadow.js";
import { isTruthyEnvValue } from "../../infra/env.js";

export const SUBAGENT_CREDIT_USAGE_ENV = "OPENBOT_SUBAGENT_CREDIT_USAGE";

/**
 * Default OFF. Only 1 / true / yes / on enable billing; unset, empty, explicit false
 * values and anything else keep it off. Independent of
 * `OPENBOT_AGENT_COMMAND_CREDIT_USAGE` (which defaults on).
 */
export function isSubagentCreditUsageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[SUBAGENT_CREDIT_USAGE_ENV]);
}

export type SubagentCreditUsageOutcome =
  | { status: "recorded"; taskId: string }
  | {
      status: "skipped";
      reason:
        | "not-subagent-lane"
        | "cli-backend"
        | "no-usage"
        | "disabled"
        | "missing-parent-authorization"
        | "billing-context-absent";
    }
  | { status: "failed"; taskId: string; error: string };

type SubagentRunResultLike = {
  meta?: {
    durationMs?: number;
    agentMeta?: { usage?: UsageLike | null };
  };
};

export type RecordSubagentRunUsageParams = {
  isSubagentLane: boolean;
  cfg: OpenBotConfig;
  /** The child run's own id: taskId and runId of the usage record, never the parent's. */
  runId: string;
  /** Provider / model that actually produced the result (post-fallback). */
  provider: string;
  model: string;
  agentId: string;
  /** Trusted, gateway-authenticated client user for this call (never from RPC params). */
  creditUserId?: string;
  /** In-process parent snapshot (`opts.spawnGovernanceSnapshot`). */
  snapshot?: RunGovernanceSnapshot;
  result: SubagentRunResultLike;
  fallbackAttempts: unknown;
  env?: NodeJS.ProcessEnv;
  onError?: (message: string) => void;
};

export async function recordSubagentRunUsage(
  params: RecordSubagentRunUsageParams,
): Promise<SubagentCreditUsageOutcome> {
  if (!params.isSubagentLane) {
    return { status: "skipped", reason: "not-subagent-lane" };
  }
  // CLI backends keep their own attribution (`recordCliBackendUsage`): no shadow, no bill.
  if (isCliProvider(params.provider, params.cfg)) {
    return { status: "skipped", reason: "cli-backend" };
  }
  const rawUsage = params.result.meta?.agentMeta?.usage;
  const tokenUsage = normalizeUsage(rawUsage);
  if (!hasNonzeroUsage(tokenUsage)) {
    return { status: "skipped", reason: "no-usage" };
  }
  const writeShadow = (reason?: typeof SUBAGENT_BILLING_CONTEXT_ABSENT_REASON) =>
    recordSubagentUsageAttributionShadow({
      isSubagentLane: true,
      isCliBackend: false,
      runId: params.runId,
      snapshot: params.snapshot,
      usage: rawUsage,
      ...(reason ? { reason } : {}),
      env: params.env,
    });

  if (!isSubagentCreditUsageEnabled(params.env)) {
    await writeShadow();
    return { status: "skipped", reason: "disabled" };
  }
  const authorizationDecisionId = params.snapshot?.commercialAuthorizationId?.trim();
  if (!authorizationDecisionId) {
    // The shadow reason is missing-parent-authorization without a parent id.
    await writeShadow();
    return { status: "skipped", reason: "missing-parent-authorization" };
  }
  const creditReporting = params.snapshot?.creditReporting;
  const enterpriseId = creditReporting?.enterpriseId?.trim();
  const policyId = creditReporting?.policyId?.trim();
  if (!enterpriseId || !policyId) {
    await writeShadow(SUBAGENT_BILLING_CONTEXT_ABSENT_REASON);
    return { status: "skipped", reason: "billing-context-absent" };
  }

  const taskId = params.runId;
  const creditUserId = params.creditUserId?.trim() || undefined;
  try {
    const payload = buildCommercialRunCreditUsageInput({
      enterpriseId,
      policyId,
      runId: taskId,
      provider: params.provider,
      model: params.model,
      ...(creditUserId ? { creditUserId } : {}),
      agentId: params.agentId,
      authorizationDecisionId,
      subscriptionId: creditReporting?.subscriptionId,
      planId: creditReporting?.planId,
      planVersionId: creditReporting?.planVersionId,
      subscriptionSnapshotId: creditReporting?.subscriptionSnapshotId,
      durationMs: params.result.meta?.durationMs,
      toolCallCount: 0,
      toolClasses: [],
      fallbackAttemptsRaw: params.fallbackAttempts,
      tokenUsage,
    });
    await enqueueUsageOutbox(payload);
    return { status: "recorded", taskId };
  } catch (err) {
    const message = String(err);
    params.onError?.(`subagent credit usage outbox enqueue failed: ${message}`);
    return { status: "failed", taskId, error: message };
  }
}
