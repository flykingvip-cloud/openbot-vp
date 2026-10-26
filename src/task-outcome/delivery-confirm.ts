/**
 * R85d: aggregate required channel deliveries with AND semantics.
 * Enqueue-only success is NOT treated as delivered.
 */

export type RequiredDeliveryAttempt =
  | {
      /** Actual channel deliver result (e.g. routeReply). */
      source: "deliver";
      ok: boolean;
      error?: string;
    }
  | {
      /** Dispatcher queue acceptance only — not a send receipt. */
      source: "enqueue_only";
      ok: boolean;
      error?: string;
    };

export type RequiredDeliveryConfirmStatus = "delivered" | "failed" | "delivery_unknown" | "none";

/**
 * Combine required delivery attempts:
 * - any actual deliver failure → failed (OR must not mask)
 * - all actual delivers ok (and no enqueue_only failure) → delivered
 * - only enqueue_only successes → delivery_unknown (enqueue ≠ send success)
 * - empty → none
 */
export function resolveRequiredDeliveryConfirmStatus(
  attempts: readonly RequiredDeliveryAttempt[],
): RequiredDeliveryConfirmStatus {
  if (attempts.length === 0) {
    return "none";
  }
  const deliver = attempts.filter((a) => a.source === "deliver");
  const enqueueOnly = attempts.filter((a) => a.source === "enqueue_only");

  if (deliver.some((a) => !a.ok) || enqueueOnly.some((a) => !a.ok)) {
    return "failed";
  }
  if (deliver.length > 0 && deliver.every((a) => a.ok)) {
    return "delivered";
  }
  // Required targets only reached enqueue — not a send receipt.
  if (enqueueOnly.length > 0) {
    return "delivery_unknown";
  }
  return "none";
}
