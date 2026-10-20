import { reportUsageEvent } from "./billing/report-usage-event.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";

/**
 * Dedicated-instance cost attribution (hybrid-gateway-isolation F6, R8.3).
 *
 * A dedicated tenant runs its own gateway instance, so its infra cost (compute/storage for that
 * instance) is a real per-tenant cost the shared pool does not have. This records that cost through
 * the EXISTING billing attribution seam (`reportUsageEvent`) rather than inventing a parallel one:
 * cost is keyed by `enterpriseId` — which IS the `tenantId` in this codebase — and lands in the same
 * usage ledger + durable billing event stream that per-tenant observability already reads. So
 * "dedicated cost per tenant" is just another usage key on the established path (cost-budget-billing
 * `enterprise_id`), not a new subsystem.
 */

/** Usage key for a dedicated instance's infra cost (distinct from ai_credits / ai_provider_cost). */
export const DEDICATED_INFRA_COST_USAGE_KEY = "dedicated_infra_cost";

export type ReportDedicatedRuntimeCostInput = {
  tenantId: string;
  /** The dedicated instance's infra cost for the period, in integer cents (>= 0). */
  cents: number;
  /** Billing period key (e.g. "2026-07") — makes the event idempotent per tenant per period. */
  period: string;
  occurredAt?: string;
  /** Injectable emit for tests. */
  deps?: { report?: typeof reportUsageEvent };
};

export type ReportDedicatedRuntimeCostResult = { recorded: boolean; deduped: boolean };

/**
 * Attribute a dedicated instance's infra cost to its tenant for a billing period. Idempotent per
 * `(tenantId, period)` via the usage event id, so re-running a period's cost roll-up never
 * double-counts. Infra cost is not user-attributed, so it is recorded under the `system` user.
 */
export async function reportDedicatedRuntimeCost(
  input: ReportDedicatedRuntimeCostInput,
): Promise<ReportDedicatedRuntimeCostResult> {
  const tenantId = canonicalizeTenantId(input.tenantId) ?? input.tenantId;
  const period = input.period.trim();
  if (!period) {
    throw new Error("period is required");
  }
  if (!Number.isFinite(input.cents) || input.cents < 0) {
    throw new Error("cents must be a non-negative number");
  }
  const report = input.deps?.report ?? reportUsageEvent;
  return report({
    enterpriseId: tenantId, // enterpriseId === tenantId (attribution key)
    userId: "system", // infra cost is tenant-level, not attributable to a user
    eventId: `dedicated-infra:${tenantId}:${period}`, // idempotent per tenant per period
    key: DEDICATED_INFRA_COST_USAGE_KEY,
    quantity: Math.round(input.cents),
    ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
  });
}
