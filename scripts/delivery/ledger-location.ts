import { existsSync } from "node:fs";

/** Historical in-repo path. The duplicated ledger was removed after OHBE took the canonical copy. */
export const LOCAL_LEDGER_PATH = "deploy/production/releases.jsonl";

/** Stub that points operators at the OHBE ledger. Presence + missing JSONL means "externalized". */
export const LOCAL_LEDGER_STUB = "deploy/production/LEDGER.md";

export const CANONICAL_LEDGER_REPO = "https://github.com/flykingvip-cloud/harness-Benchmark-Engine";

export const CANONICAL_LEDGER_URL = `${CANONICAL_LEDGER_REPO}/blob/main/deploy/production/releases.jsonl`;

export function isLocalProductionLedgerPath(ledgerPath: string): boolean {
  const normalized = ledgerPath.replaceAll("\\", "/");
  return normalized === LOCAL_LEDGER_PATH || normalized.endsWith(`/${LOCAL_LEDGER_PATH}`);
}

/** True when this checkout no longer carries the production JSONL and the stub is in its place. */
export function localLedgerExternalized(cwd = process.cwd()): boolean {
  return !existsSync(`${cwd}/${LOCAL_LEDGER_PATH}`) && existsSync(`${cwd}/${LOCAL_LEDGER_STUB}`);
}

export function externalLedgerMessage(): string {
  return `Production cutover ledger is not stored in this repo. Append rows in OHBE (${CANONICAL_LEDGER_URL}). See ${LOCAL_LEDGER_STUB}.`;
}
