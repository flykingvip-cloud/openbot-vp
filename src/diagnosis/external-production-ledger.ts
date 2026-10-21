/** Canonical production cutover ledger. It is not stored in this repository. */
export const OHBE_LEDGER_URL =
  "https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl";

/**
 * Diagnosis production CLIs used to open `deploy/production/releases.jsonl`.
 * That copy was removed after the OHBE ledger became the only append target.
 */
export function refuseLocalProductionLedger(): never {
  throw new Error(
    [
      "生产切流账本已不在本仓库。诊断命令不再读取或重建 deploy/production/releases.jsonl。",
      "The production cutover ledger is not in this repo. Diagnosis commands no longer read or recreate deploy/production/releases.jsonl.",
      `OHBE ledger / OHBE 账本: ${OHBE_LEDGER_URL}`,
      "See / 参见 deploy/production/LEDGER.md.",
    ].join("\n"),
  );
}
