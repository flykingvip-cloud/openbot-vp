/**
 * R85d/R85e: aggregate required channel deliveries with AND semantics.
 * Enqueue-only success is NOT treated as delivered.
 * Mixed deliver-ok + enqueue_only (or unknown) stays delivery_unknown —
 * a single actual success must not mask other unconfirmed required items.
 */

export type RequiredDeliveryAttempt =
  | {
      /** Actual channel deliver result (e.g. routeReply / dispatcher deliver()). */
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
 * - any explicit failure (deliver or enqueue) → failed
 * - any remaining enqueue_only (even if ok) → delivery_unknown
 * - only when EVERY attempt is an actual deliver success → delivered
 * - empty → none
 */
export function resolveRequiredDeliveryConfirmStatus(
  attempts: readonly RequiredDeliveryAttempt[],
): RequiredDeliveryConfirmStatus {
  if (attempts.length === 0) {
    return "none";
  }
  if (attempts.some((a) => !a.ok)) {
    return "failed";
  }
  // R85e: success + enqueue_only / unknown must NOT collapse to delivered.
  if (attempts.some((a) => a.source === "enqueue_only")) {
    return "delivery_unknown";
  }
  if (attempts.every((a) => a.source === "deliver" && a.ok)) {
    return "delivered";
  }
  return "delivery_unknown";
}
