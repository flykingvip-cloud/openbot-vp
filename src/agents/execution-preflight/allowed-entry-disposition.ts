/**
 * Frozen per-entry preflight disposition table (Path C / ABC Knife1).
 *
 * Code-present lock of discovery scope §3.1
 * (`phase-c-83-path-c-bypass-table-lock-scope.md`). Read-only data +
 * assertions only. Must not be imported by gateway chat / tool invoke /
 * ACP hot paths. No new OPENBOT_* observe flags. No applyPreflightToTools
 * at new call sites. Break-glass remains unauthorized commentary.
 *
 * Start-order id: `phase_c_83_path_c_bypass_table_lock_start_order` (#86).
 * Claim ceiling: code-present. C10 still cannot pass; NO-GO COMPLETE;
 * unique-benefit FAIL; 合入 ≠ PASS/GO.
 */

export type AllowedEntryDisposition =
  | "reuse-observe"
  | "exemption+break-glass"
  | "delete"
  | "n/a-not-tri-state";

export type AllowedEntryId =
  | "FC-01 /tools/invoke"
  | "FC-03a enterprise capability invoke"
  | "FC-03b node.invoke"
  | "FC-05 ACP in-process tryDispatchAcpReply"
  | "FC-06 inter-agent bus"
  | "FC-07 ACP CLI + steer"
  | "task-orchestration"
  | "Fabric"
  | "knowledge.capability.invoke"
  | "ACP stdio bridge"
  | "AOR (packages/aor-core)"
  | "Cron / subagent"
  | "ConversationTask whole-row";

export type AllowedEntryDispositionRow = {
  entry: AllowedEntryId;
  disposition: AllowedEntryDisposition;
  /** Break-glass remains unauthorized; present for exemption rows only. */
  note?: string;
};

/**
 * Frozen table matching scope §3.1 exactly. Order is stable for tests.
 * Exemption rows must never be labeled reuse-observe.
 */
export const ALLOWED_ENTRY_DISPOSITIONS: readonly AllowedEntryDispositionRow[] = [
  {
    entry: "FC-01 /tools/invoke",
    disposition: "reuse-observe",
    note: "Flag default-off; already wired observe-only.",
  },
  {
    entry: "FC-03a enterprise capability invoke",
    disposition: "reuse-observe",
    note: "Flag default-off; already wired observe-only.",
  },
  {
    entry: "FC-03b node.invoke",
    disposition: "reuse-observe",
    note: "Flag default-off; already wired observe-only.",
  },
  {
    entry: "FC-05 ACP in-process tryDispatchAcpReply",
    disposition: "reuse-observe",
    note: "Flag default-off; already wired observe-only.",
  },
  {
    entry: "FC-06 inter-agent bus",
    disposition: "reuse-observe",
    note: "Flag default-off; already wired observe-only.",
  },
  {
    entry: "FC-07 ACP CLI + steer",
    disposition: "reuse-observe",
    note: "Flag default-off; already wired observe-only.",
  },
  {
    entry: "task-orchestration",
    disposition: "exemption+break-glass",
    note: "Live-invoke unauthorized; exemption is registration-only, not production enablement.",
  },
  {
    entry: "Fabric",
    disposition: "exemption+break-glass",
    note: "Default-off; must not be opened for observation.",
  },
  {
    entry: "knowledge.capability.invoke",
    disposition: "exemption+break-glass",
    note: "No live connector; exemption is registration-only.",
  },
  {
    entry: "ACP stdio bridge",
    disposition: "exemption+break-glass",
    note: "Owner-adjudicated (#69); not soft-observe.",
  },
  {
    entry: "AOR (packages/aor-core)",
    disposition: "exemption+break-glass",
    note: "Owner-adjudicated (#69); core must not import preflight.",
  },
  {
    entry: "Cron / subagent",
    disposition: "exemption+break-glass",
    note: "Owner-adjudicated (#69); returning to hot path ≠ reuse-observe.",
  },
  {
    entry: "ConversationTask whole-row",
    disposition: "n/a-not-tri-state",
    note: "FC-02 is close-consult only; whole-row is not preflight tri-state.",
  },
] as const;

export const ALLOWED_ENTRY_DISPOSITION_VALUES: readonly AllowedEntryDisposition[] = [
  "reuse-observe",
  "exemption+break-glass",
  "delete",
  "n/a-not-tri-state",
] as const;

export function dispositionForEntry(entry: AllowedEntryId): AllowedEntryDisposition | undefined {
  return ALLOWED_ENTRY_DISPOSITIONS.find((row) => row.entry === entry)?.disposition;
}
