export type IdempotentReceiptDeliveryResult = {
  ok: boolean;
  idempotent: boolean;
};

/**
 * Canonical receipt-idempotent delivery wrapper.
 * When a durable receipt/ledger key exists (`hasReceipt: true`), a send failure
 * is recorded on the same key and returns `{ ok: false, idempotent: true }` so
 * callers can retain the prepared body and leave delivery pending recovery.
 */
export function deliverWithIdempotentReceipt(params: {
  hasReceipt: boolean;
  send: () => void;
  noteOutcome: (ok: boolean) => void;
}): IdempotentReceiptDeliveryResult {
  if (!params.hasReceipt) {
    params.send();
    return { ok: true, idempotent: false };
  }
  try {
    params.send();
    params.noteOutcome(true);
    return { ok: true, idempotent: true };
  } catch {
    params.noteOutcome(false);
    return { ok: false, idempotent: true };
  }
}
