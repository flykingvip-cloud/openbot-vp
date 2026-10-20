import type { LedgerViewMode } from "../shared/ledger-empty.ts";

let mode: LedgerViewMode = "demo";

export function readKeyAccountLedgerMode(): LedgerViewMode {
  return mode;
}

export function setKeyAccountLedgerMode(next: LedgerViewMode): void {
  mode = next;
}

export function resetKeyAccountLedgerMode(): void {
  mode = "demo";
}
