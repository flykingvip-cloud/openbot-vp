import { createHash } from "node:crypto";
import { observeObjective, type ObserveContext } from "./observe.js";
import type { ShadowObserveInput, ShadowObserveRecord } from "./types.js";

/** Stable hash over resolve + proposed units + codes. Used by replay tests; no JSONL write. */
export function stableReplayHash(record: ShadowObserveRecord): string {
  const payload = {
    resolveStatus: record.resolveStatus,
    proposed: record.proposed,
    conflictCodes: [...record.conflictCodes].toSorted(),
    rejectOrDiscardCodes: [...record.rejectOrDiscardCodes].toSorted(),
    proposedDisposition: record.proposedDisposition,
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function replayObserve(
  input: ShadowObserveInput,
  ctx: ObserveContext,
): { record: ShadowObserveRecord; hash: string } {
  const record = observeObjective(input, ctx);
  return { record, hash: stableReplayHash(record) };
}
