import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_ENTRY_DISPOSITION_VALUES,
  ALLOWED_ENTRY_DISPOSITIONS,
  dispositionForEntry,
  type AllowedEntryDisposition,
  type AllowedEntryId,
} from "./allowed-entry-disposition.js";

/** Scope §3.1 frozen checklist (start-order phase_c_83_path_c_bypass_table_lock_start_order). */
const SCOPE_31_ENTRIES: ReadonlyArray<{
  entry: AllowedEntryId;
  disposition: AllowedEntryDisposition;
}> = [
  { entry: "FC-01 /tools/invoke", disposition: "reuse-observe" },
  { entry: "FC-03a enterprise capability invoke", disposition: "reuse-observe" },
  { entry: "FC-03b node.invoke", disposition: "reuse-observe" },
  { entry: "FC-05 ACP in-process tryDispatchAcpReply", disposition: "reuse-observe" },
  { entry: "FC-06 inter-agent bus", disposition: "reuse-observe" },
  { entry: "FC-07 ACP CLI + steer", disposition: "reuse-observe" },
  { entry: "task-orchestration", disposition: "exemption+break-glass" },
  { entry: "Fabric", disposition: "exemption+break-glass" },
  { entry: "knowledge.capability.invoke", disposition: "exemption+break-glass" },
  { entry: "ACP stdio bridge", disposition: "exemption+break-glass" },
  { entry: "AOR (packages/aor-core)", disposition: "exemption+break-glass" },
  { entry: "Cron / subagent", disposition: "exemption+break-glass" },
  { entry: "ConversationTask whole-row", disposition: "n/a-not-tri-state" },
];

const LEGAL_DISPOSITIONS = new Set<AllowedEntryDisposition>([
  "reuse-observe",
  "exemption+break-glass",
  "delete",
  "n/a-not-tri-state",
]);

describe("allowed-entry-disposition (Path C freeze)", () => {
  it("covers every scope §3.1 entry with the exact disposition", () => {
    expect(ALLOWED_ENTRY_DISPOSITIONS).toHaveLength(SCOPE_31_ENTRIES.length);
    for (const expected of SCOPE_31_ENTRIES) {
      const row = ALLOWED_ENTRY_DISPOSITIONS.find((r) => r.entry === expected.entry);
      expect(row, `missing entry: ${expected.entry}`).toBeDefined();
      expect(row!.disposition).toBe(expected.disposition);
      expect(dispositionForEntry(expected.entry)).toBe(expected.disposition);
    }
  });

  it("only allows dispositions in reuse-observe | exemption+break-glass | delete | n/a-not-tri-state", () => {
    expect(ALLOWED_ENTRY_DISPOSITION_VALUES).toEqual([
      "reuse-observe",
      "exemption+break-glass",
      "delete",
      "n/a-not-tri-state",
    ]);
    for (const row of ALLOWED_ENTRY_DISPOSITIONS) {
      expect(LEGAL_DISPOSITIONS.has(row.disposition)).toBe(true);
    }
  });

  it("never labels exemption+break-glass entries as reuse-observe", () => {
    const exemptions = ALLOWED_ENTRY_DISPOSITIONS.filter(
      (row) => row.disposition === "exemption+break-glass",
    );
    expect(exemptions.length).toBeGreaterThan(0);
    for (const row of exemptions) {
      expect(row.disposition).not.toBe("reuse-observe");
      expect(row.disposition).toBe("exemption+break-glass");
    }
  });

  it("marks ConversationTask whole-row as n/a-not-tri-state", () => {
    expect(dispositionForEntry("ConversationTask whole-row")).toBe("n/a-not-tri-state");
  });

  it("is not exported from the preflight barrel (no hot-path forced import)", () => {
    const barrel = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(barrel).not.toContain("allowed-entry-disposition");
  });
});
