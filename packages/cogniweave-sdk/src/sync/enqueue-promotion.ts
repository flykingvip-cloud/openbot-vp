import type { CloudAuthContext } from "./cloud-client.js";
import type { PromotionConsentMutation } from "./consent.js";
import type { SyncOutbox, SyncOutboxEntry } from "./outbox.js";
import type { PromotionDecision } from "./promotion-decision.js";
import { assertPromotionEnvelopeHygiene } from "./promotion-envelope.js";

/**
 * Bridge P5-01 consent/decision → P5-02 SyncOutbox enqueue.
 */

export async function enqueuePromotionOutbox(params: {
  outbox: SyncOutbox;
  mutation: PromotionConsentMutation;
  decision: PromotionDecision;
  auth: CloudAuthContext;
}): Promise<SyncOutboxEntry | null> {
  const atom = params.mutation.atom;
  const atomVersion = atom.versioning.version;

  if (
    params.mutation.outboxIntent === "delete_tombstone" ||
    params.decision.decision === "revoked"
  ) {
    return params.outbox.enqueue({
      atomId: atom.id,
      operation: "delete_tombstone",
      tenantId: params.auth.tenantId,
      deviceId: params.auth.deviceId,
      atomVersion,
    });
  }

  if (
    params.mutation.outboxIntent === "push" &&
    params.decision.decision === "ready" &&
    params.decision.envelope
  ) {
    const violations = assertPromotionEnvelopeHygiene(params.decision.envelope);
    if (violations.length > 0) {
      throw new Error(`enqueuePromotionOutbox: envelope hygiene failed: ${violations.join(",")}`);
    }
    return params.outbox.enqueue({
      atomId: atom.id,
      operation: "push",
      tenantId: params.auth.tenantId,
      deviceId: params.auth.deviceId,
      atomVersion,
      envelope: params.decision.envelope,
    });
  }

  return null;
}
