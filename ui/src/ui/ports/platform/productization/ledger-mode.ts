import type { LedgerViewMode } from "../shared/ledger-empty.ts";

let mode: LedgerViewMode = "demo";

export function readProductizationLedgerMode(): LedgerViewMode {
  return mode;
}

export function setProductizationLedgerMode(next: LedgerViewMode): void {
  mode = next;
}

export function resetProductizationLedgerMode(): void {
  mode = "demo";
}
