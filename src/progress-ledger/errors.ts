import type { LedgerInvariantId } from "./types.js";

export class LedgerWriteError extends Error {
  readonly code: string;
  readonly invariantId?: LedgerInvariantId;

  constructor(message: string, code = "LEDGER_WRITE_REJECTED", invariantId?: LedgerInvariantId) {
    super(message);
    this.name = "LedgerWriteError";
    this.code = code;
    this.invariantId = invariantId;
  }
}

export class LedgerInvariantError extends LedgerWriteError {
  constructor(id: LedgerInvariantId, message: string) {
    super(`${id}: ${message}`, "LEDGER_INVARIANT", id);
    this.name = "LedgerInvariantError";
  }
}
